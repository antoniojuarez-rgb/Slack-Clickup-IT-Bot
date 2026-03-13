/**
 * Handles Slack interactive components (e.g. Take Ticket button).
 * Request URL from Slack: application/x-www-form-urlencoded with payload=JSON.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { SlackMessageBlock } from "../types/slack.js";
import { verifySlackSignature, checkRateLimit } from "../lib/security.js";
import { updateTask, closeTask, reopenTask, postComment } from "../lib/clickup.js";
import {
  buildTicketMessageBlocks,
  buildClosureThreadBlocks,
  updateMessage,
  getSlackUserInfo,
  getThreadReplies,
  getChannelMessage,
  postMessageInThread,
  postEphemeral,
} from "../lib/slack.js";
import { env } from "../config/env.js";
import {
  saveReopenTimestamp,
  getReopenTimestamp,
  clearReopenTimestamp,
  saveAssignee,
  saveClosedTs,
  getClosedTs,
  getReopenCount,
  incrementReopenCount,
  getReporter,
  getAssignee,
} from "../lib/threadStore.js";
import { log } from "../utils/logger.js";
import { getRawBody } from "../utils/request.js";

export const config = { api: { bodyParser: false } };

function cleanBlocks(blocks: unknown[]): unknown[] {
  const disallowed = ['verbatim', 'app_id', 'bot_id', 'container'];
  function clean(obj: unknown): unknown {
    if (Array.isArray(obj)) return obj.map(clean);
    if (obj && typeof obj === 'object') {
      const cleaned: Record<string, unknown> = {};
      for (const key in obj as Record<string, unknown>) {
        if (!disallowed.includes(key)) {
          cleaned[key] = clean((obj as Record<string, unknown>)[key]);
        }
      }
      return cleaned;
    }
    return obj;
  }
  return clean(blocks) as unknown[];
}

interface BlockActionPayload {
  type: string;
  user?: { id: string; username?: string; name?: string };
  channel?: { id: string };
  message?: { ts: string; thread_ts?: string; blocks?: unknown[] };
  actions?: Array<{ action_id: string; value?: string }>;
}

/** Format Slack ts (e.g. "1234567890.123456") to "3:15 PM" */
function formatSlackTime(ts: string): string {
  const date = new Date(parseFloat(ts) * 1000);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Strip markdown to plain text (no bold, no asterisks) */
function toPlainText(s: string): string {
  return s
    .replace(/\*+|\_+/g, "")
    .replace(/^>\s?/gm, "")
    .replace(/`/g, "")
    .trim();
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
    (a) =>
      a.action_id === "take_ticket" ||
      a.action_id === "close_ticket" ||
      a.action_id === "reopen_ticket"
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

  /** Decode + to space so URL-encoded payload from Slack matches our regexes. */
  function decodeSpaces(s: string): string {
    return s.replace(/\+/g, " ").trim();
  }

  function extractDataFromBlocks(blocks: unknown[]): {
    requester: string;
    priority: string;
    typeOfRequest: string;
    description: string;
    troubleshootingSteps: string;
    ticketId: string;
    ticketUrl: string;
  } {
    let requester = "", priority = "", typeOfRequest = "", description = "",
      troubleshootingSteps = "", ticketId = "", ticketUrl = "";

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i] as Record<string, unknown>;
      const textObj = b.text as { text?: string } | undefined;
      log("debug", {
        event: "extract_block",
        index: i,
        text: textObj?.text,
        fields: b.fields,
      });

      if (b.type === "section" && Array.isArray(b.fields)) {
        for (const field of b.fields as Array<Record<string, string>>) {
          const raw = field.text ?? "";
          const text = decodeSpaces(raw);
          const rm = text.match(/^\*Requester:\*\n([\s\S]+)$/);
          if (rm) requester = decodeSpaces(rm[1]);
          const pm = text.match(/^\*Priority:\*\n([\s\S]+)$/);
          if (pm) priority = decodeSpaces(pm[1]);
          const tm = text.match(/^\*Type:\*\n([\s\S]+)$/);
          if (tm) typeOfRequest = decodeSpaces(tm[1]);
          const idm = text.match(/^\*Ticket ID:\*\n<([^|]+)\|([^>]+)>$/);
          if (idm) {
            ticketUrl = decodeSpaces(idm[1]);
            ticketId = decodeSpaces(idm[2]);
          }
        }
      }

      if (b.type === "section" && b.text && typeof (b.text as Record<string, string>).text === "string") {
        const raw = (b.text as Record<string, string>).text;
        const text = decodeSpaces(raw);
        const dm = text.match(/^\*Description:\*\n([\s\S]+)$/);
        if (dm && dm[1] !== "_No description_") description = decodeSpaces(dm[1]);
        const tsm = text.match(/^\*Troubleshooting steps:\*\n([\s\S]+)$/);
        if (tsm) troubleshootingSteps = decodeSpaces(tsm[1]);
      }
    }

    const extracted = { requester, priority, typeOfRequest, description, troubleshootingSteps, ticketId, ticketUrl };
    log("debug", { event: "extract_result", data: extracted });
    return extracted;
  }

  const rawBlocks = (payload.message?.blocks ?? []) as unknown[];
  const extracted = extractDataFromBlocks(rawBlocks);
  const ticketUrl = extracted.ticketUrl || `https://app.clickup.com/t/${taskId}`;
  const ticketId = extracted.ticketId || `ITOPS-${taskId.slice(-6)}`;

  if (actionId === "take_ticket") {
    const userMap = env.SLACK_TO_CLICKUP_USER_MAP();
    if (userMap[slackUserId] === undefined) {
      await postEphemeral(channelId, slackUserId, "You are not authorized to take tickets. Please contact your IT administrator.");
      res.status(200).end();
      return;
    }
    const clickUpUserId = userMap[slackUserId];

    if (clickUpUserId !== undefined) {
      try {
        await updateTask(taskId, { assignees: { add: [clickUpUserId] } });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        log("api_error", { reason: "clickup_assign_failed", details: message });
      }
    }
    await saveAssignee(taskId, slackUserId);

    log("ticket_claimed", { taskId, slackUserId });

    const blocks = buildTicketMessageBlocks({
      requester: extracted.requester,
      priority: extracted.priority,
      typeOfRequest: extracted.typeOfRequest,
      description: extracted.description,
      troubleshootingSteps: extracted.troubleshootingSteps,
      ticketId,
      taskId,
      ticketUrl,
      isClaimed: true,
      claimedBy: displayName,
    });

      log("slack_update_blocks", { action: "take_ticket", blocks: JSON.stringify(blocks) });
    try {
      await updateMessage(channelId, messageTs, cleanBlocks(blocks) as any[]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log("api_error", { reason: "slack_update_failed", details: message });
    }
  } else if (actionId === "close_ticket") {
    // Feature 1: Copy Slack thread to ClickUp as a single comment before closing
    try {
      const reopenTs = await getReopenTimestamp(taskId);
      const replies = await getThreadReplies(channelId, messageTs);
      const skipFirst = replies.slice(1);
      const afterReopen = reopenTs
        ? skipFirst.filter((msg) => msg.ts && parseFloat(msg.ts) > parseFloat(reopenTs))
        : skipFirst;
      const lines: string[] = [];
      for (const msg of afterReopen) {
        const userId = msg.user ?? "";
        let name = "Unknown";
        if (userId) {
          const info = await getSlackUserInfo(userId);
          if (info?.real_name) name = info.real_name;
          else if (info?.name) name = info.name;
        }
        const timeStr = msg.ts ? formatSlackTime(msg.ts) : "";
        const text = toPlainText(msg.text ?? "");
        lines.push(`${name} - ${timeStr}:\n  ${text}`);
      }
      const threadBody = lines.join("\n\n");
      const commentText =
        "--- Slack Thread History ---\n\n" + (threadBody || "(no replies in thread)");
      await postComment(taskId, commentText);
      await clearReopenTimestamp(taskId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log("api_error", { reason: "thread_to_clickup_failed", details: message });
    }

    try {
      await closeTask(taskId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log("api_error", { reason: "clickup_close_failed", details: message });
    }
    await saveClosedTs(taskId, String(Date.now() / 1000));

    log("ticket_closed", { taskId, slackUserId });

    const blocks = buildTicketMessageBlocks({
      requester: extracted.requester,
      priority: extracted.priority,
      typeOfRequest: extracted.typeOfRequest,
      description: extracted.description,
      troubleshootingSteps: extracted.troubleshootingSteps,
      ticketId,
      taskId,
      ticketUrl,
      isClaimed: true,
      isClosed: true,
      closedBy: displayName,
    });

    log("slack_update_blocks", { action: "close_ticket", blocks: JSON.stringify(blocks) });
    try {
      await updateMessage(channelId, messageTs, cleanBlocks(blocks) as any[]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log("api_error", { reason: "slack_update_failed", details: message });
    }

    // Feature 2: Post closure message in thread with Reabrir Ticket button
    const closureText = `Your issue has been closed by ${displayName}. If you still need help, use the button below:`;
    const closureBlocks = buildClosureThreadBlocks(taskId, displayName);
    try {
      await postMessageInThread(channelId, messageTs, closureText, closureBlocks);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log("api_error", { reason: "closure_thread_message_failed", details: message });
    }
  } else if (actionId === "reopen_ticket") {
    try {
      const mainMessageTs = (payload.message as { thread_ts?: string })?.thread_ts;
      if (!mainMessageTs) {
        log("api_error", { reason: "reopen_missing_thread_ts", taskId });
        res.status(200).end();
        return;
      }

      const mainMessage = await getChannelMessage(channelId, mainMessageTs);
      const mainBlocks = (mainMessage?.blocks ?? []) as unknown[];
      const extracted = extractDataFromBlocks(mainBlocks);
      const ticketUrl =
        extracted.ticketUrl || `https://app.clickup.com/t/${taskId}`;
      const ticketId =
        extracted.ticketId || `ITOPS-${taskId.slice(-6)}`;

      const closedTs = await getClosedTs(taskId);
      if (closedTs) {
        const closedAt = parseFloat(closedTs) * 1000;
        if (Date.now() - closedAt > 24 * 60 * 60 * 1000) {
          await postEphemeral(
            channelId,
            slackUserId,
            "⚠️ More than 24 hours have passed since this ticket was closed. Please open a new ticket."
          );
          res.status(200).end();
          return;
        }
      }

      const reopenCount = await getReopenCount(taskId);
      if (reopenCount >= 2) {
        await postEphemeral(
          channelId,
          slackUserId,
          "⚠️ This ticket has already been reopened 2 times. Please open a new ticket."
        );
        res.status(200).end();
        return;
      }

      await incrementReopenCount(taskId);
      const reopenStatus = env.CLICKUP_REOPEN_STATUS();
      await reopenTask(taskId, reopenStatus);
      await saveReopenTimestamp(taskId, messageTs);

      const reporterId = await getReporter(taskId);
      const assigneeId = await getAssignee(taskId);
      let reporterDisplay = reporterId ? `<@${reporterId}>` : "user";
      if (reporterId) {
        const info = await getSlackUserInfo(reporterId);
        if (info?.real_name) reporterDisplay = info.real_name;
        else if (info?.name) reporterDisplay = `@${info.name}`;
      }
      let assigneeDisplay = assigneeId ? `<@${assigneeId}>` : "the team";
      if (assigneeId) {
        const info = await getSlackUserInfo(assigneeId);
        if (info?.real_name) assigneeDisplay = info.real_name;
        else if (info?.name) assigneeDisplay = `@${info.name}`;
      }

      await postComment(
        taskId,
        `🔄 Issue reabierto por ${reporterDisplay}`
      );

      const threadReopenText =
        (reporterId
          ? `🔄 <@${reporterId}> has reopened the ticket. `
          : "🔄 Ticket reopened. ") +
        (assigneeId
          ? `<@${assigneeId}> please follow up.`
          : "Please follow up.");
      await postMessageInThread(channelId, mainMessageTs, threadReopenText);

      const closureBlocksOnlyContext: SlackMessageBlock[] = [
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: reporterId
                ? `🔄 Ticket reopened by <@${reporterId}>`
                : "🔄 Ticket reopened.",
            },
          ],
        },
      ];
      await updateMessage(channelId, messageTs, closureBlocksOnlyContext);

      const mainBlocksRebuilt = buildTicketMessageBlocks({
        requester: extracted.requester,
        priority: extracted.priority,
        typeOfRequest: extracted.typeOfRequest,
        description: extracted.description,
        troubleshootingSteps: extracted.troubleshootingSteps,
        ticketId,
        taskId,
        ticketUrl,
        isClaimed: true,
        claimedBy: assigneeDisplay,
      });
      await updateMessage(
        channelId,
        mainMessageTs,
        cleanBlocks(mainBlocksRebuilt) as any[]
      );

      log("ticket_reopened", { taskId, slackUserId });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log("api_error", { reason: "clickup_reopen_failed", details: message });
    }
  }

  res.status(200).end();
}
