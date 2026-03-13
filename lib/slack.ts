/**
 * Slack API: post message, update message, build Block Kit payloads.
 */

import type { SlackMessageBlock } from "../types/slack.js";
import { isHighPriority } from "./priority.js";
import { log } from "../utils/logger.js";

const SLACK_API_BASE = "https://slack.com/api";

function getBotToken(): string {
  const t = process.env.SLACK_BOT_TOKEN;
  if (!t) throw new Error("SLACK_BOT_TOKEN is not set");
  return t;
}

/**
 * Call Slack API with 429 handling: wait Retry-After and retry once; then log and throw if still failing.
 */
async function slackApiFetch(url: string, init: RequestInit): Promise<Response> {
  let res = await fetch(url, init);
  if (res.status === 429) {
    const retryAfterSec = Math.min(
      120,
      Math.max(1, parseInt(res.headers.get("Retry-After") ?? "60", 10) || 60)
    );
    await new Promise((r) => setTimeout(r, retryAfterSec * 1000));
    res = await fetch(url, init);
    if (res.status === 429 || !res.ok) {
      const body = await res.json().catch(() => ({}));
      const errMsg = (body as { error?: string }).error ?? `Slack API error: ${res.status}`;
      log("api_error", { reason: "slack_429_retry_failed", status: res.status, details: errMsg });
      throw new Error(errMsg);
    }
    return res;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Slack API error: ${res.status}`);
  }
  return res;
}

export function buildTicketMessageBlocks(params: {
  requester: string;
  priority: string;
  typeOfRequest: string;
  description: string;
  troubleshootingSteps: string;
  ticketId: string;
  taskId: string;
  ticketUrl: string;
  isClaimed?: boolean;
  claimedBy?: string;
  isClosed?: boolean;
  closedBy?: string;
}): SlackMessageBlock[] {
  const {
    requester,
    priority,
    typeOfRequest,
    description,
    troubleshootingSteps,
    ticketId,
    taskId,
    ticketUrl,
    isClaimed,
    claimedBy,
    isClosed,
    closedBy,
  } = params;

  const SLACK_BLOCK_TEXT_MAX = 2900;
  const truncate = (s: string): string =>
    s.length <= SLACK_BLOCK_TEXT_MAX ? s : s.slice(0, SLACK_BLOCK_TEXT_MAX) + "... (truncated)";
  const safeDescription = truncate(description || "_No description_");
  const safeTroubleshooting = troubleshootingSteps ? truncate(troubleshootingSteps) : "";

  const blocks: SlackMessageBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "💻 New IT TechStop Ticket", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Thank you for reaching out to TechStop! We will review your request and get back to you shortly. :bufo-salute:",
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Requester:*\n${requester}` },
        { type: "mrkdwn", text: `*Priority:*\n${priority}` },
        { type: "mrkdwn", text: `*Type:*\n${typeOfRequest}` },
        { type: "mrkdwn", text: `*Ticket ID:*\n<${ticketUrl}|${ticketId}>` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Description:*\n${safeDescription}`,
      },
    },
  ];

  if (safeTroubleshooting) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Troubleshooting steps:*\n${safeTroubleshooting}`,
      },
    });
  }

  if (isClosed && closedBy) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `✅ Closed by ${closedBy}` }],
    });
  } else if (isClaimed && claimedBy) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `🙋 Claimed by ${claimedBy}` }],
    });
  }

  const actions: SlackMessageBlock["elements"] = [
    {
      type: "button",
      text: { type: "plain_text", text: "Open Ticket", emoji: true },
      url: ticketUrl,
      action_id: "open_ticket",
    },
  ];

  // Slack API does not accept disabled on buttons (invalid_blocks). Omit claimed/closed buttons instead.
  if (!isClaimed && !isClosed) {
    (actions as Record<string, unknown>[]).push({
      type: "button",
      text: { type: "plain_text", text: "Take Ticket", emoji: true },
      value: taskId,
      action_id: "take_ticket",
    });
  }

  if (isClaimed && !isClosed) {
    (actions as Record<string, unknown>[]).push({
      type: "button",
      text: { type: "plain_text", text: "Close Ticket", emoji: true },
      value: taskId,
      action_id: "close_ticket",
      style: "danger",
    });
  }
  // When isClosed: only Open Ticket; no Take/Close buttons

  blocks.push({
    type: "actions",
    elements: actions,
  });

  return blocks;
}

/**
 * Clone existing message blocks, remove Take Ticket button (Slack API rejects disabled), add "Claimed by" context.
 */
export function markBlocksAsClaimed(
  existingBlocks: unknown[],
  claimedBy: string
): SlackMessageBlock[] {
  const blocks = JSON.parse(JSON.stringify(existingBlocks)) as SlackMessageBlock[];
  let claimedContextInserted = false;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === "actions" && Array.isArray(b.elements)) {
      const elements = (b.elements as Record<string, unknown>[]).filter(
        (el) => el.action_id !== "take_ticket"
      );
      (b as { elements: unknown[] }).elements = elements;
    }
    if (b.type === "context" && !claimedContextInserted) {
      (b as { elements?: unknown[] }).elements = [
        { type: "mrkdwn", text: `🙋 Claimed by ${claimedBy}` },
      ];
      claimedContextInserted = true;
    }
  }
  if (!claimedContextInserted) {
    const contextBlock: SlackMessageBlock = {
      type: "context",
      elements: [{ type: "mrkdwn", text: `🙋 Claimed by ${claimedBy}` }],
    };
    const lastActions = blocks.findIndex((b) => b.type === "actions");
    if (lastActions >= 0) blocks.splice(lastActions, 0, contextBlock);
    else blocks.push(contextBlock);
  }
  return blocks;
}

/**
 * Clone existing message blocks, remove Take Ticket and Close Ticket buttons (Slack API rejects disabled),
 * and replace/add a "Closed by" context block.
 */
export function markBlocksAsClosed(
  existingBlocks: unknown[],
  closedBy: string
): SlackMessageBlock[] {
  const blocks = JSON.parse(JSON.stringify(existingBlocks)) as SlackMessageBlock[];
  let closedContextInserted = false;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === "actions" && Array.isArray(b.elements)) {
      const elements = (b.elements as Record<string, unknown>[]).filter(
        (el) => el.action_id !== "take_ticket" && el.action_id !== "close_ticket"
      );
      (b as { elements: unknown[] }).elements = elements;
    }
    if (b.type === "context" && !closedContextInserted) {
      (b as { elements?: unknown[] }).elements = [
        { type: "mrkdwn", text: `✅ Closed by ${closedBy}` },
      ];
      closedContextInserted = true;
    }
  }
  if (!closedContextInserted) {
    const contextBlock: SlackMessageBlock = {
      type: "context",
      elements: [{ type: "mrkdwn", text: `✅ Closed by ${closedBy}` }],
    };
    const lastActions = blocks.findIndex((b) => b.type === "actions");
    if (lastActions >= 0) blocks.splice(lastActions, 0, contextBlock);
    else blocks.push(contextBlock);
  }
  return blocks;
}

/**
 * If priority is High, prepend @itopsteam to the first section or add a mention block.
 */
export function maybeAddHighPriorityMention(
  blocks: SlackMessageBlock[],
  priority: string
): SlackMessageBlock[] {
  if (!isHighPriority(priority)) return blocks;
  const tag = process.env.ITOPS_TEAM_TAG || "@itopsteam";
  return [
    { type: "section", text: { type: "mrkdwn", text: tag } },
    ...blocks,
  ];
}

export async function postMessage(
  channelId: string,
  blocks: SlackMessageBlock[],
  text?: string
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  const res = await slackApiFetch(`${SLACK_API_BASE}/chat.postMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getBotToken()}`,
    },
    body: JSON.stringify({
      channel: channelId,
      text: text ?? "New IT Helpdesk ticket",
      blocks,
    }),
  });

  const data = (await res.json()) as { ok: boolean; ts?: string; error?: string };
  if (!data.ok) {
    throw new Error(data.error ?? "Slack API error");
  }
  return data;
}

export async function updateMessage(
  channelId: string,
  messageTs: string,
  blocks: SlackMessageBlock[],
  text?: string
): Promise<{ ok: boolean; error?: string; response_metadata?: unknown }> {
  const res = await slackApiFetch(`${SLACK_API_BASE}/chat.update`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getBotToken()}`,
    },
    body: JSON.stringify({
      channel: channelId,
      ts: messageTs,
      text: text ?? "IT Helpdesk ticket updated",
      blocks,
    }),
  });

  const data = (await res.json()) as {
    ok: boolean;
    error?: string;
    response_metadata?: unknown;
    [key: string]: unknown;
  };
  if (!data.ok) {
    log("api_error", {
      reason: "slack_update_failed",
      details: data.error,
      response_metadata: data.response_metadata,
    });
    throw new Error(data.error ?? "Slack API error");
  }
  return data;
}

export async function getSlackUserInfo(userId: string): Promise<{
  id: string;
  real_name?: string;
  name?: string;
  profile?: { email?: string };
} | null> {
  const res = await fetch(
    `${SLACK_API_BASE}/users.info?user=${encodeURIComponent(userId)}`,
    {
      headers: { Authorization: `Bearer ${getBotToken()}` },
    }
  );
  const data = (await res.json()) as {
    ok: boolean;
    user?: { id: string; real_name?: string; name?: string; profile?: { email?: string } };
  };
  if (!data.ok || !data.user) return null;
  return data.user;
}

/**
 * Post an ephemeral message (visible only to the given user).
 */
export async function postEphemeral(
  channelId: string,
  userId: string,
  text: string
): Promise<void> {
  const res = await slackApiFetch(`${SLACK_API_BASE}/chat.postEphemeral`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getBotToken()}`,
    },
    body: JSON.stringify({
      channel: channelId,
      user: userId,
      text,
    }),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) {
    throw new Error(data.error ?? "Slack API error");
  }
}

/** Slack thread message from conversations.replies */
export interface SlackThreadMessage {
  user?: string;
  text?: string;
  ts?: string;
  [key: string]: unknown;
}

/**
 * Fetch a single message by ts (conversations.history with latest + inclusive).
 * Use to get the main ticket message when handling reopen from the closure message.
 */
export async function getChannelMessage(
  channelId: string,
  messageTs: string
): Promise<{ blocks?: unknown[]; [key: string]: unknown } | null> {
  const params = new URLSearchParams({
    channel: channelId,
    latest: messageTs,
    limit: "1",
    inclusive: "true",
  });
  const res = await fetch(`${SLACK_API_BASE}/conversations.history?${params}`, {
    headers: { Authorization: `Bearer ${getBotToken()}` },
  });
  const data = (await res.json()) as {
    ok: boolean;
    messages?: Array<{ blocks?: unknown[]; [key: string]: unknown }>;
    error?: string;
  };
  if (!data.ok || !Array.isArray(data.messages) || data.messages.length === 0) {
    return null;
  }
  return data.messages[0] ?? null;
}

/**
 * Fetch all messages in a thread (conversations.replies).
 * First message is the parent; use thread_ts as the parent message ts.
 */
export async function getThreadReplies(
  channelId: string,
  threadTs: string
): Promise<SlackThreadMessage[]> {
  const params = new URLSearchParams({
    channel: channelId,
    ts: threadTs,
  });
  const res = await fetch(`${SLACK_API_BASE}/conversations.replies?${params}`, {
    headers: { Authorization: `Bearer ${getBotToken()}` },
  });
  const data = (await res.json()) as {
    ok: boolean;
    messages?: SlackThreadMessage[];
    error?: string;
  };
  if (!data.ok || !Array.isArray(data.messages)) {
    throw new Error(data.error ?? "conversations.replies failed");
  }
  return data.messages;
}

/**
 * Blocks for the "closure" message in the thread: text + Reabrir Ticket button.
 */
export function buildClosureThreadBlocks(
  taskId: string,
  closedByDisplay: string
): SlackMessageBlock[] {
  const text = `Your issue has been closed by ${closedByDisplay}. If you still need help, use the button below:`;
  return [
    { type: "section", text: { type: "mrkdwn", text } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Reopen Ticket", emoji: true },
          value: taskId,
          action_id: "reopen_ticket",
        },
      ],
    },
  ];
}

/**
 * Post a message into a thread (chat.postMessage with thread_ts).
 */
export async function postMessageInThread(
  channelId: string,
  threadTs: string,
  text: string,
  blocks?: SlackMessageBlock[]
): Promise<{ ok: boolean; ts?: string; error?: string }> {
  const body: Record<string, unknown> = {
    channel: channelId,
    thread_ts: threadTs,
    text,
  };
  if (blocks?.length) body.blocks = blocks;
  const res = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getBotToken()}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; ts?: string; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? `Slack API error: ${res.status}`);
  }
  return data;
}
