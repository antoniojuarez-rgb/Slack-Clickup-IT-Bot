/**
 * Event logging. Never log tokens or API keys.
 */

// Never log: CLICKUP_API_KEY, SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, UPSTASH_REDIS_*, SHEETS_WEBHOOK_SECRET
const SENSITIVE_KEYS = [
  "token",
  "secret",
  "key",
  "authorization",
  "password",
  "signing_secret",
  "api_key",
  "bot_token",
  "clickup_api_key",
  "slack_bot_token",
  "slack_signing_secret",
  "upstash_redis",
  "sheets_webhook_secret",
];

function sanitize(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const lower = k.toLowerCase();
    if (SENSITIVE_KEYS.some((s) => lower.includes(s))) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = sanitize(v);
    }
  }
  return out;
}

export type LogEvent =
  | "ticket_created"
  | "ticket_claimed"
  | "ticket_closed"
  | "ticket_reopened"
  | "comment_synced"
  | "api_error"
  | "validation_error"
  | "security_reject"
  | "slack_update_blocks"
  | "debug";

export function log(event: LogEvent, details?: Record<string, unknown>): void {
  const payload = {
    event,
    timestamp: new Date().toISOString(),
    ...(details && { details: sanitize(details) }),
  };
  console.log(JSON.stringify(payload));
}
