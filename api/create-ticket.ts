/**
 * Receives Slack Workflow webhook → creates ClickUp task → posts formatted message to Slack.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createTask, getTask, getTaskUrl } from "../lib/clickup.js";
import {
  buildTicketMessageBlocks,
  maybeAddHighPriorityMention,
  postMessage,
} from "../lib/slack.js";
import { slackPriorityToClickUp } from "../lib/priority.js";
import { verifySlackSignature, checkRateLimit, getSlackUserIdFromPayload } from "../lib/security.js";
import { validateWorkflowPayload, getWorkflowFields } from "../utils/validator.js";
import { log } from "../utils/logger.js";
import { saveThreadMapping } from "../lib/threadStore.js";

export const config = { api: { bodyParser: false } };

function getRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
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

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    log("validation_error", { reason: "invalid_json" });
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const slackUserId = getSlackUserIdFromPayload(payload);
  if (slackUserId && !checkRateLimit(slackUserId)) {
    log("security_reject", { reason: "rate_limited" });
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  const { valid, missing } = validateWorkflowPayload(payload);
  if (!valid) {
    log("validation_error", { missing });
    res.status(400).json({ error: "Missing required fields", missing });
    return;
  }

  const listId = process.env.CLICKUP_LIST_ID;
  const channelId = process.env.SLACK_CHANNEL_ID;
  if (!listId || !channelId) {
    log("api_error", { reason: "missing_env" });
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  const { requester, description, priority, type_of_request, troubleshooting_steps } =
    getWorkflowFields(payload);

  const taskName = `[${type_of_request || "Request"}] ${description.slice(0, 80)}${description.length > 80 ? "…" : ""}`;
  const taskDescription = [
    `**Requester:** ${requester}`,
    `**Priority:** ${priority}`,
    `**Type:** ${type_of_request}`,
    ``,
    description,
    troubleshooting_steps ? `\n**Troubleshooting:**\n${troubleshooting_steps}` : "",
  ].join("\n");

  try {
    const created = await createTask(listId, {
      name: taskName,
      description: taskDescription,
      priority: slackPriorityToClickUp(priority),
    });

    const taskId = created.id;
    const taskRes = await getTask(taskId);
    const customId = taskRes.custom_id ?? `ITOPS-${taskId.slice(-6)}`;
    const ticketUrl = getTaskUrl(taskId);

    let blocks = buildTicketMessageBlocks({
      requester,
      priority,
      typeOfRequest: type_of_request,
      description,
      troubleshootingSteps: troubleshooting_steps,
      ticketId: customId,
      taskId,
      ticketUrl,
    });
    blocks = maybeAddHighPriorityMention(blocks, priority);

    const msgResult = await postMessage(channelId, blocks);
    if (msgResult.ts) {
      saveThreadMapping(msgResult.ts, taskId);
    }

    log("ticket_created", {
      taskId,
      customId,
      priority,
      type: type_of_request,
    });

    res.status(200).json({ ok: true, task_id: taskId, custom_id: customId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log("api_error", { reason: message });
    res.status(500).json({ error: "Failed to create ticket", details: message });
  }
}
