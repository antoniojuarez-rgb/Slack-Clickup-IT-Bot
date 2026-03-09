/**
 * Unit tests: Slack signature verification and rate limiting
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

const sign = (secret: string, body: string, timestamp: string): string => {
  const base = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac("sha256", secret).update(base).digest("hex");
  return `v0=${hmac}`;
};

describe("verifySlackSignature", () => {
  const secret = "test_signing_secret";
  const body = '{"type":"event"}';
  const timestamp = String(Math.floor(Date.now() / 1000));

  beforeEach(() => {
    vi.stubEnv("SLACK_SIGNING_SECRET", secret);
  });

  it("returns true for valid signature", async () => {
    const { verifySlackSignature } = await import("../lib/security.js");
    const signature = sign(secret, body, timestamp);
    expect(verifySlackSignature(body, signature, timestamp)).toBe(true);
  });

  it("returns false for wrong signature", async () => {
    const { verifySlackSignature } = await import("../lib/security.js");
    expect(verifySlackSignature(body, "v0=wrong", timestamp)).toBe(false);
  });

  it("returns false when timestamp missing", async () => {
    const { verifySlackSignature } = await import("../lib/security.js");
    const signature = sign(secret, body, timestamp);
    expect(verifySlackSignature(body, signature, undefined)).toBe(false);
  });

  it("returns false for expired timestamp (>5 min old)", async () => {
    const { verifySlackSignature } = await import("../lib/security.js");
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400);
    const signature = sign(secret, body, oldTimestamp);
    expect(verifySlackSignature(body, signature, oldTimestamp)).toBe(false);
  });
});

describe("checkRateLimit", () => {
  it("allows under limit", async () => {
    const { checkRateLimit } = await import("../lib/security.js");
    const id = "user_" + Math.random();
    expect(checkRateLimit(id)).toBe(true);
  });

  it("allows after limit for different user", async () => {
    const { checkRateLimit } = await import("../lib/security.js");
    const id = "user_a_" + Math.random();
    for (let i = 0; i < 10; i++) checkRateLimit(id);
    expect(checkRateLimit("user_b_" + Math.random())).toBe(true);
  });

  it("allows 10 requests then blocks the 11th", async () => {
    const { checkRateLimit } = await import("../lib/security.js");
    const id = "user_limit_" + Math.random();
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(id)).toBe(true);
    }
    expect(checkRateLimit(id)).toBe(false);
  });

  it("resets after 1 minute window", async () => {
    const { checkRateLimit } = await import("../lib/security.js");
    const id = "user_reset_" + Math.random();
    // Exhaust the limit
    for (let i = 0; i < 10; i++) checkRateLimit(id);
    expect(checkRateLimit(id)).toBe(false);

    // Simulate time passing: stub Date.now to be 61 seconds ahead
    const realNow = Date.now;
    const future = realNow() + 61_000;
    vi.spyOn(Date, "now").mockReturnValue(future);

    expect(checkRateLimit(id)).toBe(true);
    vi.restoreAllMocks();
  });
});
