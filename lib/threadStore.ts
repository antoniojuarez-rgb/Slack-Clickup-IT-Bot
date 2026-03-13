/**
 * Redis-backed store (Upstash) for thread → task mapping and reopen timestamps.
 * TTL 30 days on all keys.
 */

import { Redis } from "@upstash/redis";

const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export function getRedis(): Redis {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.UPSTASH_REDIS_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.UPSTASH_REDIS_TOKEN;
  if (!url || !token) {
    throw new Error("Missing UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN (or REST_ variant)");
  }
  return new Redis({ url, token });
}

const PREFIX_THREAD = "thread:";
const PREFIX_REOPEN = "reopen:";
const PREFIX_REPORTER = "reporter:";
const PREFIX_ASSIGNEE = "assignee:";
const PREFIX_CLOSED_TS = "closed_ts:";
const PREFIX_REOPEN_COUNT = "reopen_count:";

/**
 * Save thread ts → task id (when ticket is created).
 */
export async function saveThreadMapping(
  threadTs: string,
  taskId: string
): Promise<void> {
  const redis = getRedis();
  const key = `${PREFIX_THREAD}${threadTs}`;
  await redis.set(key, taskId, { ex: TTL_SECONDS });
}

/**
 * Get task id from thread ts (for comment sync in slack-events.ts).
 */
export async function getTaskIdFromThread(
  threadTs: string
): Promise<string | null> {
  const redis = getRedis();
  const key = `${PREFIX_THREAD}${threadTs}`;
  const value = await redis.get<string>(key);
  return value ?? null;
}

/**
 * Save reopen timestamp (when ticket is reopened).
 * Used on close to only copy thread messages after this ts.
 */
export async function saveReopenTimestamp(
  taskId: string,
  ts: string
): Promise<void> {
  const redis = getRedis();
  const key = `${PREFIX_REOPEN}${taskId}`;
  await redis.set(key, ts, { ex: TTL_SECONDS });
}

/**
 * Get reopen timestamp (when closing, to only copy thread from this point).
 */
export async function getReopenTimestamp(
  taskId: string
): Promise<string | null> {
  const redis = getRedis();
  const key = `${PREFIX_REOPEN}${taskId}`;
  const value = await redis.get<string>(key);
  return value ?? null;
}

/**
 * Clear reopen timestamp (after copying thread on close).
 */
export async function clearReopenTimestamp(taskId: string): Promise<void> {
  const redis = getRedis();
  const key = `${PREFIX_REOPEN}${taskId}`;
  await redis.del(key);
}

/**
 * Save reporter Slack user ID (when ticket is created).
 */
export async function saveReporter(
  taskId: string,
  slackUserId: string
): Promise<void> {
  const redis = getRedis();
  await redis.set(`${PREFIX_REPORTER}${taskId}`, slackUserId, {
    ex: TTL_SECONDS,
  });
}

/**
 * Get reporter Slack user ID.
 */
export async function getReporter(taskId: string): Promise<string | null> {
  const redis = getRedis();
  const value = await redis.get<string>(`${PREFIX_REPORTER}${taskId}`);
  return value ?? null;
}

/**
 * Save assignee Slack user ID (when ticket is claimed).
 */
export async function saveAssignee(
  taskId: string,
  slackUserId: string
): Promise<void> {
  const redis = getRedis();
  await redis.set(`${PREFIX_ASSIGNEE}${taskId}`, slackUserId, {
    ex: TTL_SECONDS,
  });
}

/**
 * Get assignee Slack user ID.
 */
export async function getAssignee(taskId: string): Promise<string | null> {
  const redis = getRedis();
  const value = await redis.get<string>(`${PREFIX_ASSIGNEE}${taskId}`);
  return value ?? null;
}

/**
 * Save closed timestamp (when ticket is closed). Use Unix seconds for 24h check.
 */
export async function saveClosedTs(
  taskId: string,
  ts: string
): Promise<void> {
  const redis = getRedis();
  await redis.set(`${PREFIX_CLOSED_TS}${taskId}`, ts, {
    ex: TTL_SECONDS,
  });
}

/**
 * Get closed timestamp (for 24h reopen guard).
 */
export async function getClosedTs(taskId: string): Promise<string | null> {
  const redis = getRedis();
  const value = await redis.get<string>(`${PREFIX_CLOSED_TS}${taskId}`);
  return value ?? null;
}

/**
 * Get reopen count for this task.
 */
export async function getReopenCount(taskId: string): Promise<number> {
  const redis = getRedis();
  const key = `${PREFIX_REOPEN_COUNT}${taskId}`;
  const value = await redis.get<string>(key);
  if (value == null) return 0;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Increment reopen count (TTL 30 days on key).
 */
export async function incrementReopenCount(taskId: string): Promise<void> {
  const redis = getRedis();
  const key = `${PREFIX_REOPEN_COUNT}${taskId}`;
  const newCount = await redis.incr(key);
  if (newCount === 1) {
    await redis.expire(key, TTL_SECONDS);
  }
}
