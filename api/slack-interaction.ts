/**
 * Handles Slack interactive components (e.g. Take Ticket button).
 * Request URL from Slack: application/x-www-form-urlencoded with payload=JSON.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifySlackSignature, checkRateLimit } from "../lib/security.js";
import { updateTask, closeTask } from "../lib/clickup.js";
import {
  buildTicketMessageBlocks,
  markBlocksAsClaimed,
  markBlocksAsClosed,
  updateMessage,
  getSlackUserInfo,
} from "../lib/slack.js";
import { env } from "../config/env.js";
import { log } from "../utils/logger.js";
import { getRawBody } from "../utils/request.js";

export const config = { api: { bodyParser: false } };

interface BlockActionPayload {
  type: string;
  user?: { id: string; username?: string; name?: string };
  channel?: { id: string };
  message?: { ts: string; blocks?: unknown[] };
  actions?: Array<{ action_id: string; value?: string }>;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let rawBody: string;
  try {
    rawBody = await getRawBody(req);
  } catch {
    rawBody = "";
  }

  const signature = req.headers["x-slack-signature"] as string | undefined;
  const timestamp = req.headers["x-slack-request-timestamp"] as string | undefined;

  if (!verifySlackSignature(rawBody, signature, timestamp)) {
    log("security_reject", { reason: "invalid_slack_signature" });
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  let payloadStr: string;
  try {
    if (rawBody.startsWith("payload=")) {
      payloadStr = decodeURIComponent(rawBody.replace(/^payload=/, ""));
    } else {
      const parsed = JSON.parse(rawBody) as { payload?: string };
      payloadStr = typeof parsed.payload === "string" ? parsed.payload : rawBody;
    }
  } catch {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  let payload: BlockActionPayload;
  try {
    payload = JSON.parse(payloadStr) as BlockActionPayload;
  } catch {
    res.status(400).json({ error: "Invalid JSON payload" });
    return;
  }

  if (payload.type !== "block_actions" || !payload.actions?.length) {
    res.status(200).end();
    return;
  }

  const userId = payload.user?.id;
  if (userId && !checkRateLimit(userId)) {
    log("security_reject", { reason: "rate_limited" });
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  const action = payload.actions.find(
    (a) => a.action_id === "take_ticket" || a.action_id === "close_ticket"
  );
  if (!action?.value) {
    res.status(200).end();
    return;
  }

  const taskId = action.value;
  const actionId = action.action_id;
  const slackUserId = payload.user?.id;
  const channelId = payload.channel?.id;
  const messageTs = payload.message?.ts;

  if (!slackUserId || !channelId || !messageTs) {
    log("api_error", { reason: "missing_interaction_context" });
    res.status(500).json({ error: "Missing user or channel" });
    return;
  }

  let displayName = `<@${slackUserId}>`;
  try {
    const userInfo = await getSlackUserInfo(slackUserId);
    if (userInfo?.real_name) displayName = userInfo.real_name;
    else if (userInfo?.name) displayName = `@${userInfo.name}`;
  } catch {
    // keep displayName as <@id>
  }

  const existingBlocks: unknown[] = JSON.parse(
    decodeURIComponent(JSON.stringify(payload.message?.blocks ?? []))
  );

  if (actionId === "take_ticket") {
    const userMap = env.SLACK_TO_CLICKUP_USER_MAP();
    const clickUpUserId = userMap[slackUserId];

    if (clickUpUserId !== undefined) {
      try {
        await updateTask(taskId, { assignees: { add: [clickUpUserId] } });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        log("api_error", { reason: "clickup_assign_failed", details: message });
      }
    }

    log("ticket_claimed", { taskId, slackUserId });

    const blocks =
      existingBlocks.length > 0
        ? markBlocksAsClaimed(existingBlocks, displayName)
        : buildTicketMessageBlocks({
            requester: "",
            priority: "",
            typeOfRequest: "",
            description: "",
            troubleshootingSteps: "",
            ticketId: `ITOPS-${taskId.slice(-6)}`,
            taskId,
            ticketUrl: `https://app.clickup.com/t/${taskId}`,
            isClaimed: true,
            claimedBy: displayName,
          });

    log("slack_update_blocks", { action: "take_ticket", blocks: JSON.stringify(blocks) });
    try {
      await updateMessage(channelId, messageTs, blocks);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log("api_error", { reason: "slack_update_failed", details: message });
    }
  } else if (actionId === "close_ticket") {
    try {
      await closeTask(taskId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log("api_error", { reason: "clickup_close_failed", details: message });
    }

    log("ticket_closed", { taskId, slackUserId });

    const blocks =
      existingBlocks.length > 0
        ? markBlocksAsClosed(existingBlocks, displayName)
        : buildTicketMessageBlocks({
            requester: "",
            priority: "",
            typeOfRequest: "",
            description: "",
            troubleshootingSteps: "",
            ticketId: `ITOPS-${taskId.slice(-6)}`,
            taskId,
            ticketUrl: `https://app.clickup.com/t/${taskId}`,
            isClaimed: true,
            isClosed: true,
            closedBy: displayName,
          });

    log("slack_update_blocks", { action: "close_ticket", blocks: JSON.stringify(blocks) });
    try {
      await updateMessage(channelId, messageTs, blocks);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log("api_error", { reason: "slack_update_failed", details: message });
    }
  }

  res.status(200).end();
}
