/**
 * Slack request verification and rate limiting.
 */

import crypto from "node:crypto";
import { getRedis } from "./threadStore.js";

const SLACK_SIGNATURE_PREFIX = "v0=";
const MAX_AGE_SECONDS = 60 * 5; // 5 minutes
const RATE_LIMIT_PER_MINUTE = 10;

// In-memory rate limit (per serverless instance). For multi-instance use Redis/Vercel KV.
const rateLimitMap = new Map<string, number[]>();

const RATE_LIMIT_IP_PER_MINUTE = 10;
const RATE_LIMIT_IP_TTL_SECONDS = 60;
const RATE_LIMIT_IP_PREFIX = "ratelimit:ip:";

function getSlackSigningSecret(): string {
  return process.env.SLACK_SIGNING_SECRET ?? "";
}

/**
 * Verify Slack request using X-Slack-Signature and X-Slack-Request-Timestamp.
 * Use raw body (string) as received.
 */
export function verifySlackSignature(
  rawBody: string,
  signature: string | undefined,
  timestamp: string | undefined
): boolean {
  const secret = getSlackSigningSecret();
  if (!secret || !signature?.startsWith(SLACK_SIGNATURE_PREFIX) || !timestamp) {
    return false;
  }

  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts)) return false;
  const age = Math.abs(Date.now() / 1000 - ts);
  if (age > MAX_AGE_SECONDS) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac("sha256", secret).update(base).digest("hex");
  const expected = SLACK_SIGNATURE_PREFIX + hmac;

  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * Rate limit: 10 requests per minute per identifier (e.g. Slack user ID).
 * Returns true if allowed, false if rate limited.
 */
export function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  let times = rateLimitMap.get(identifier) ?? [];
  times = times.filter((t) => t > windowStart);

  if (times.length >= RATE_LIMIT_PER_MINUTE) {
    return false;
  }
  times.push(now);
  rateLimitMap.set(identifier, times);
  return true;
}

/**
 * Rate limit by IP: 10 requests per 60 seconds per IP (Redis).
 * Key: ratelimit:ip:{ip}, TTL 60 seconds.
 * Returns true if allowed, false if rate limited.
 */
export async function checkRateLimitByIp(ip: string): Promise<boolean> {
  const redis = getRedis();
  const key = `${RATE_LIMIT_IP_PREFIX}${ip}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, RATE_LIMIT_IP_TTL_SECONDS);
  }
  if (count > RATE_LIMIT_IP_PER_MINUTE) {
    await redis.decr(key);
    return false;
  }
  return true;
}

export function getSlackUserIdFromPayload(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "user" in payload) {
    const user = (payload as { user?: { id?: string } }).user;
    return user?.id ?? null;
  }
  if (payload && typeof payload === "object" && "requester" in payload) {
    const r = (payload as { requester?: string }).requester;
    if (typeof r === "string") return r;
  }
  return null;
}
