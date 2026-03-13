/**
 * Slack alerts: post error/warning messages to a dedicated channel.
 * Failures are swallowed so alerts never break the main flow.
 */

import { env } from "../config/env.js";

const SLACK_API_BASE = "https://slack.com/api";

function formatTimestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/**
 * Post an alert to SLACK_ALERTS_CHANNEL_ID. Never throws.
 */
export async function sendAlert(
  level: "error" | "warning",
  event: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    const channelId = env.SLACK_ALERTS_CHANNEL_ID();
    const token = env.SLACK_BOT_TOKEN();
    const emoji = level === "error" ? "🔴" : "🟡";
    const timestamp = formatTimestamp();
    const detailsStr = Object.entries(details)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join("\n");
    const text = `${emoji} *${event}*\n📅 ${timestamp}\n${detailsStr}`;

    const res = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel: channelId,
        text,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text },
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error("[sendAlert] Slack API error:", res.status, (body as { error?: string }).error);
    }
  } catch (err) {
    console.error("[sendAlert] failed:", err instanceof Error ? err.message : err);
  }
}
