/**
 * Slack Events API handler.
 * - Responds to url_verification challenge
 * - Syncs thread replies to ClickUp comments
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifySlackSignature, checkRateLimit } from "../lib/security.js";
import { getTaskIdFromThread } from "../lib/threadStore.js";
import { postComment } from "../lib/clickup.js";
import { log } from "../utils/logger.js";
import { getRawBody } from "../utils/request.js";

export const config = { api: { bodyParser: false } };

interface SlackEvent {
  type: string;
  text?: string;
  user?: string;
  username?: string;
  thread_ts?: string;
  ts?: string;
  subtype?: string;
}

interface SlackEventPayload {
  type: string;
  challenge?: string;
  event?: SlackEvent;
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

  let payload: SlackEventPayload;
  try {
    payload = JSON.parse(rawBody) as SlackEventPayload;
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  // Handle url_verification before signature check (Slack sends no signature on first setup)
  if (payload.type === "url_verification" && payload.challenge) {
    res.status(200).json({ challenge: payload.challenge });
    return;
  }

  const signature = req.headers["x-slack-signature"] as string | undefined;
  const timestamp = req.headers["x-slack-request-timestamp"] as string | undefined;

  if (!verifySlackSignature(rawBody, signature, timestamp)) {
    log("security_reject", { reason: "invalid_slack_signature" });
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const event = payload.event;

  // Only handle thread replies (message events with thread_ts set and no subtype to avoid bot loops)
  if (
    payload.type !== "event_callback" ||
    !event ||
    event.type !== "message" ||
    !event.thread_ts ||
    event.subtype // ignore edited/deleted/bot messages
  ) {
    res.status(200).end();
    return;
  }

  if (event.user && !checkRateLimit(event.user)) {
    log("security_reject", { reason: "rate_limited" });
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  const taskId = await getTaskIdFromThread(event.thread_ts);
  if (!taskId) {
    // No mapped task for this thread — ignore
    res.status(200).end();
    return;
  }

  const userName = event.username ?? event.user ?? "Unknown";
  const text = event.text ?? "";
  const commentText = `Slack User: @${userName}\n\nMessage:\n${text}`;

  try {
    await postComment(taskId, commentText);
    log("comment_synced", { taskId, thread_ts: event.thread_ts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log("api_error", { reason: "clickup_comment_failed", details: message });
  }

  res.status(200).end();
}
