/**
 * Receives POST requests from Google Apps Script → creates ClickUp task → posts formatted message to Slack.
 * Authenticates via x-webhook-secret header instead of Slack signature verification.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createTask, getTask, getTaskUrl, setCustomField } from "../lib/clickup.js";
import {
  buildTicketMessageBlocks,
  maybeAddHighPriorityMention,
  postMessage,
} from "../lib/slack.js";
import { slackPriorityToClickUp } from "../lib/priority.js";
import { checkRateLimit, checkRateLimitByIp } from "../lib/security.js";
import { validateWorkflowPayload, getWorkflowFields } from "../utils/validator.js";
import { log } from "../utils/logger.js";
import { saveThreadMapping } from "../lib/threadStore.js";
import { sendAlert } from "../lib/alerts.js";
import { getRawBody } from "../utils/request.js";

export const config = { api: { bodyParser: false } };

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  log("debug", { event: "sheets_webhook_start" });
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const clientIp =
    (typeof req.headers["x-forwarded-for"] === "string"
      ? req.headers["x-forwarded-for"].split(",")[0].trim()
      : null) ??
    (typeof req.headers["x-real-ip"] === "string" ? req.headers["x-real-ip"] : null) ??
    "unknown";
  if (!(await checkRateLimitByIp(clientIp))) {
    log("security_reject", { reason: "rate_limited_ip" });
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  const webhookSecret = process.env.SHEETS_WEBHOOK_SECRET;
  if (!webhookSecret) {
    log("api_error", { reason: "missing_sheets_webhook_secret_env" });
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  const providedSecret = req.headers["x-webhook-secret"];
  if (!providedSecret || providedSecret !== webhookSecret) {
    log("security_reject", { reason: "invalid_webhook_secret" });
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let rawBody: string;
  try {
    rawBody = await getRawBody(req);
  } catch {
    rawBody = "";
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    log("validation_error", { reason: "invalid_json" });
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const requesterKey =
    typeof payload["requester"] === "string" ? payload["requester"] : null;
  if (requesterKey && !checkRateLimit(requesterKey)) {
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

  const taskName = `${type_of_request || "Request"} | ${priority} | ${requester}`;
  const taskDescription = [
    `Requester: ${requester}`,
    `Priority: ${priority}`,
    `Type: ${type_of_request}`,
    ``,
    description,
    troubleshooting_steps ? `\nTroubleshooting:\n${troubleshooting_steps}` : "",
  ].join("\n");

  log("debug", { event: "create_ticket_payload", name: taskName, description: taskDescription });

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
      await saveThreadMapping(msgResult.ts, taskId);
      const threadTsSlug = msgResult.ts.replace(".", "");
      const slackThreadUrl = `https://felix-pago.slack.com/archives/${channelId}/p${threadTsSlug}`;
      log("debug", { event: "slack_thread_url", url: slackThreadUrl, taskId });
      try {
        await setCustomField(
          taskId,
          "c93b86cd-a64f-44a8-8df7-f237dbdec893",
          slackThreadUrl
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        log("api_error", { reason: "clickup_slack_thread_field_failed", details: msg });
      }
    }

    log("ticket_created", {
      taskId,
      customId,
      priority,
      type: type_of_request,
      source: "sheets-webhook",
    });

    res.status(200).json({ ok: true, task_id: taskId, custom_id: customId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log("api_error", { reason: message });
    await sendAlert("error", "ticket_creation_failed", {
      Requester: requester,
      Type: type_of_request,
      Priority: priority,
      Error: message,
    });
    res.status(500).json({ error: "Failed to create ticket" });
  }
}
