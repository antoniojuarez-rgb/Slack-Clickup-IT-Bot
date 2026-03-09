/**
 * Unit tests: ClickUp helpers (getTaskUrl, no live API calls)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTaskUrl } from "../lib/clickup.js";

describe("getTaskUrl", () => {
  it("returns correct ClickUp task URL", () => {
    expect(getTaskUrl("86e08bva6")).toBe("https://app.clickup.com/t/86e08bva6");
  });
});

describe("createTask", () => {
  it("builds correct request (mocked)", async () => {
    vi.stubEnv("CLICKUP_API_KEY", "pk_test");
    const listId = "list123";
    const payload = {
      name: "[Access Request] Test",
      description: "Desc",
      priority: 2,
    };
    const mockRes = { id: "task1", custom_id: null };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockRes),
    });

    const { createTask } = await import("../lib/clickup.js");
    const result = await createTask(listId, payload);

    expect(result.id).toBe("task1");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/list/${listId}/task`),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
      })
    );
    vi.restoreAllMocks();
  });
});

describe("getTask", () => {
  it("returns task with custom_id when mocked", async () => {
    vi.stubEnv("CLICKUP_API_KEY", "pk_test");
    const taskId = "86e08bva6";
    const mockRes = { id: taskId, custom_id: "ITOPS-142" };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockRes),
    });

    const { getTask } = await import("../lib/clickup.js");
    const result = await getTask(taskId);

    expect(result.custom_id).toBe("ITOPS-142");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/task/${taskId}`),
      expect.objectContaining({ method: "GET" })
    );
    vi.restoreAllMocks();
  });
});

describe("updateTask", () => {
  it("uses POST and { assignees: { add: [...] } }", async () => {
    vi.stubEnv("CLICKUP_API_KEY", "pk_test");
    const taskId = "86e08bva6";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: taskId, custom_id: null, name: "Test" }),
    });

    const { updateTask } = await import("../lib/clickup.js");
    await updateTask(taskId, { assignees: { add: [99999] } });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/task/${taskId}`),
      expect.objectContaining({ method: "POST" })
    );
    const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(options.body as string)).toEqual({ assignees: { add: [99999] } });
    vi.restoreAllMocks();
  });
});
