/**
 * Slack API: post message, update message, build Block Kit payloads.
 */

import type { SlackMessageBlock } from "../types/slack.js";
import { isHighPriority } from "./priority.js";

const SLACK_API_BASE = "https://slack.com/api";

function getBotToken(): string {
  const t = process.env.SLACK_BOT_TOKEN;
  if (!t) throw new Error("SLACK_BOT_TOKEN is not set");
  return t;
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
  } = params;

  const blocks: SlackMessageBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "🎫 New IT Helpdesk Ticket", emoji: true },
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
        text: `*Description:*\n${description || "_No description_"}`,
      },
    },
  ];

  if (troubleshootingSteps) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Troubleshooting steps:*\n${troubleshootingSteps}`,
      },
    });
  }

  if (isClaimed && claimedBy) {
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

  if (!isClaimed) {
    (actions as Record<string, unknown>[]).push({
      type: "button",
      text: { type: "plain_text", text: "Take Ticket", emoji: true },
      value: taskId,
      action_id: "take_ticket",
    });
  } else {
    (actions as Record<string, unknown>[]).push({
      type: "button",
      text: { type: "plain_text", text: "Take Ticket", emoji: true },
      value: taskId,
      action_id: "take_ticket",
      disabled: true,
    });
  }

  blocks.push({
    type: "actions",
    elements: actions,
    block_id: `ticket_${taskId}`,
  });

  return blocks;
}

/**
 * Clone existing message blocks, disable Take Ticket button, and add "Claimed by" context.
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
      for (const el of b.elements as Record<string, unknown>[]) {
        if (el.action_id === "take_ticket") el.disabled = true;
      }
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
  const res = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
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
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? `Slack API error: ${res.status}`);
  }
  return data;
}

export async function updateMessage(
  channelId: string,
  messageTs: string,
  blocks: SlackMessageBlock[],
  text?: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${SLACK_API_BASE}/chat.update`, {
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

  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? `Slack API error: ${res.status}`);
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
