/**
 * Integration-style test: full create-ticket flow with mocks
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

describe("workflow integration", () => {
  beforeEach(() => {
    vi.stubEnv("CLICKUP_LIST_ID", "list123");
    vi.stubEnv("SLACK_CHANNEL_ID", "C123");
    vi.stubEnv("CLICKUP_API_KEY", "pk_test");
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
  });

  it("createTask and getTask sequence returns custom_id", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "task_abc", custom_id: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: "task_abc", custom_id: "ITOPS-142" }),
      });

    const { createTask, getTask } = await import("../lib/clickup.js");
    const created = await createTask("list123", {
      name: "Test",
      description: "Desc",
      priority: 2,
    });
    const task = await getTask(created.id);
    expect(task.custom_id).toBe("ITOPS-142");
    vi.restoreAllMocks();
  });
});
