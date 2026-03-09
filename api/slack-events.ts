/**
 * Slack Events API handler.
 * - Responds to url_verification challenge
 * - Syncs thread replies to ClickUp comments
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifySlackSignature } from "../lib/security.js";
import { getTaskIdForThread } from "../lib/threadStore.js";
import { log } from "../utils/logger.js";

export const config = { api: { bodyParser: false } };

const CLICKUP_BASE = "https://api.clickup.com/api/v2";

function getRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function getClickUpHeaders(): Record<string, string> {
  const key = process.env.CLICKUP_API_KEY;
  if (!key) throw new Error("CLICKUP_API_KEY is not set");
  return {
    "Content-Type": "application/json",
    Authorization: key,
  };
}

async function postClickUpComment(taskId: string, commentText: string): Promise<void> {
  const res = await fetch(`${CLICKUP_BASE}/task/${taskId}/comment`, {
    method: "POST",
    headers: getClickUpHeaders(),
    body: JSON.stringify({ comment_text: commentText, notify_all: false }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickUp comment failed: ${res.status} ${text}`);
  }
}

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

  const taskId = getTaskIdForThread(event.thread_ts);
  if (!taskId) {
    // No mapped task for this thread — ignore
    res.status(200).end();
    return;
  }

  const userName = event.username ?? event.user ?? "Unknown";
  const text = event.text ?? "";
  const commentText = `Slack User: @${userName}\n\nMessage:\n${text}`;

  try {
    await postClickUpComment(taskId, commentText);
    log("ticket_created", { reason: "thread_comment_synced", taskId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log("api_error", { reason: "clickup_comment_failed", details: message });
  }

  res.status(200).end();
}
