/**
 * Receives POST requests from Google Apps Script → creates ClickUp task → posts formatted message to Slack.
 * Authenticates via x-webhook-secret header instead of Slack signature verification.
 */

import crypto from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createTask, getTask, getTaskUrl, setCustomField } from "../lib/clickup.js";
import {
  buildTicketMessageBlocks,
  maybeAddHighPriorityMention,
  postMessage,
  resolveSlackUserId,
} from "../lib/slack.js";
import { slackPriorityToClickUp } from "../lib/priority.js";
import { checkRateLimit, checkRateLimitByIp } from "../lib/security.js";
import { validateWorkflowPayload, getWorkflowFields } from "../utils/validator.js";
import { log } from "../utils/logger.js";
import { getRedis, saveReporter, saveThreadMapping } from "../lib/threadStore.js";
import { sendAlert } from "../lib/alerts.js";
import { getRawBody, PayloadTooLargeError } from "../utils/request.js";

export const config = { api: { bodyParser: false } };

const SHEETS_WEBHOOK_MAX_BODY_BYTES = 512 * 1024;

function webhookSecretsEqual(provided: string, expected: string): boolean {
  const hp = crypto.createHash("sha256").update(Buffer.from(provided, "utf8")).digest();
  const he = crypto.createHash("sha256").update(Buffer.from(expected, "utf8")).digest();
  return crypto.timingSafeEqual(hp, he);
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
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

  const headerRaw = req.headers["x-webhook-secret"];
  const providedSecret =
    typeof headerRaw === "string"
      ? headerRaw
      : Array.isArray(headerRaw)
        ? headerRaw[0]
        : undefined;
  if (!providedSecret || !webhookSecretsEqual(providedSecret, webhookSecret)) {
    log("security_reject", { reason: "invalid_webhook_secret" });
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const idempotencyKeyRaw = req.headers["x-idempotency-key"];
  const idempotencyKey =
    typeof idempotencyKeyRaw === "string"
      ? idempotencyKeyRaw.trim()
      : Array.isArray(idempotencyKeyRaw)
        ? (idempotencyKeyRaw[0] as string)?.trim()
        : "";
  if (idempotencyKey) {
    const redis = getRedis();
    const redisKey = `idempotency:${idempotencyKey}`;
    const wasSet = await redis.set(redisKey, "1", {
      nx: true,
      ex: 24 * 60 * 60,
    });
    if (wasSet !== "OK") {
      res.status(200).json({
        status: "duplicate",
        message: "Already processed",
      });
      return;
    }
  }

  let rawBody: string;
  try {
    rawBody = await getRawBody(req, SHEETS_WEBHOOK_MAX_BODY_BYTES);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      res.status(413).json({ error: "Payload too large" });
      return;
    }
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

  const resolvedRequesterId = await resolveSlackUserId(requester);
  const requesterDisplay = resolvedRequesterId ? `<@${resolvedRequesterId}>` : requester;

  const taskName = `${type_of_request || "Request"} | ${priority} | ${requesterDisplay}`;
  const taskDescription = [
    `Requester: ${requesterDisplay}`,
    `Priority: ${priority}`,
    `Type: ${type_of_request}`,
    ``,
    description,
    troubleshooting_steps ? `\nTroubleshooting:\n${troubleshooting_steps}` : "",
  ].join("\n");

  try {
    const created = await createTask(listId, {
      name: taskName,
      description: taskDescription,
      priority: slackPriorityToClickUp(priority),
    });

    const taskId = created.id;
    if (resolvedRequesterId) {
      await saveReporter(taskId, resolvedRequesterId);
    }
    const taskRes = await getTask(taskId);
    const customId = taskRes.custom_id ?? `ITOPS-${taskId.slice(-6)}`;
    const ticketUrl = getTaskUrl(taskId);

    let blocks = buildTicketMessageBlocks({
      requester: requesterDisplay,
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
      try {
        await setCustomField(
          taskId,
          "c93b86cd-a64f-44a8-8df7-f237dbdec893",
          slackThreadUrl
        );
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log("api_error", {
          reason: error.message,
          stack: error.stack,
          cause: error.cause,
        });
      }
    }

    log("ticket_created", {
      taskId,
      customId,
      priority,
      type: type_of_request.length > 50 ? type_of_request.slice(0, 50) + "..." : type_of_request,
      source: "sheets-webhook",
    });

    res.status(200).json({ ok: true, task_id: taskId, custom_id: customId });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log("api_error", {
      reason: error.message,
      stack: error.stack,
      cause: error.cause,
    });
    await sendAlert("error", "ticket_creation_failed", {
      Requester: requester,
      Type: type_of_request,
      Priority: priority,
      Error: error.message,
    });
    res.status(500).json({ error: "Failed to create ticket" });
  }
}
