/**
 * Redis-backed store (Upstash) for thread → task mapping and reopen timestamps.
 * TTL 30 days on all keys.
 */

import { Redis } from "@upstash/redis";

const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function getRedis(): Redis {
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
