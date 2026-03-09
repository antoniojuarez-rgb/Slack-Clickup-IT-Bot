/**
 * Unit tests: Slack message builder (no live API calls)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildTicketMessageBlocks,
  maybeAddHighPriorityMention,
  markBlocksAsClaimed,
} from "../lib/slack.js";

describe("buildTicketMessageBlocks", () => {
  const baseParams = {
    requester: "@user",
    priority: "High",
    typeOfRequest: "Access Request",
    description: "Need access to Tableau",
    troubleshootingSteps: "none",
    ticketId: "ITOPS-142",
    taskId: "86e08bva6",
    ticketUrl: "https://app.clickup.com/t/86e08bva6",
  };

  it("includes header and fields", () => {
    const blocks = buildTicketMessageBlocks(baseParams);
    expect(blocks.some((b) => b.type === "header")).toBe(true);
    const section = blocks.find((b) => b.type === "section" && b.fields);
    expect(section).toBeDefined();
    expect(JSON.stringify(section)).toContain("ITOPS-142");
    expect(JSON.stringify(section)).toContain("High");
  });

  it("includes Open Ticket and Take Ticket buttons when not claimed", () => {
    const blocks = buildTicketMessageBlocks(baseParams);
    const actions = blocks.find((b) => b.type === "actions");
    expect(actions).toBeDefined();
    const elements = (actions as { elements?: unknown[] }).elements ?? [];
    expect(elements.length).toBeGreaterThanOrEqual(2);
    const takeBtn = elements.find(
      (e) => (e as { action_id?: string }).action_id === "take_ticket"
    );
    expect(takeBtn).toBeDefined();
    expect((takeBtn as { disabled?: boolean }).disabled).not.toBe(true);
  });

  it("disables Take Ticket when claimed", () => {
    const blocks = buildTicketMessageBlocks({
      ...baseParams,
      isClaimed: true,
      claimedBy: "@engineer",
    });
    const actions = blocks.find((b) => b.type === "actions");
    const elements = (actions as { elements?: unknown[] }).elements ?? [];
    const takeBtn = elements.find(
      (e) => (e as { action_id?: string }).action_id === "take_ticket"
    );
    expect((takeBtn as { disabled?: boolean }).disabled).toBe(true);
  });
});

describe("maybeAddHighPriorityMention", () => {
  it("prepends mention block for High (Within 1 hours) priority", () => {
    const blocks = [{ type: "header", text: { type: "plain_text", text: "x" } }];
    const out = maybeAddHighPriorityMention(blocks, "High (Within 1 hours)");
    expect(out.length).toBe(blocks.length + 1);
    expect(out[0].type).toBe("section");
  });

  it("does not add block for Medium priority", () => {
    const blocks = [{ type: "header", text: { type: "plain_text", text: "x" } }];
    const out = maybeAddHighPriorityMention(blocks, "Medium");
    expect(out).toEqual(blocks);
  });

  it("does not add block for Low priority", () => {
    const blocks = [{ type: "header", text: { type: "plain_text", text: "x" } }];
    const out = maybeAddHighPriorityMention(blocks, "Low");
    expect(out).toEqual(blocks);
  });
});

describe("markBlocksAsClaimed", () => {
  it("disables take_ticket and adds claimed context", () => {
    const blocks = [
      { type: "section", text: { type: "mrkdwn", text: "Ticket" } },
      {
        type: "actions",
        elements: [
          { type: "button", action_id: "open_ticket" },
          { type: "button", action_id: "take_ticket" },
        ],
      },
    ];
    const out = markBlocksAsClaimed(blocks, "@alice");
    const actions = out.find((b) => b.type === "actions");
    const takeBtn = (actions as { elements?: { action_id?: string; disabled?: boolean }[] })
      .elements?.find((e) => e.action_id === "take_ticket");
    expect(takeBtn?.disabled).toBe(true);
    const context = out.find((b) => b.type === "context");
    expect(context).toBeDefined();
    expect(JSON.stringify(context)).toContain("Claimed by @alice");
  });
});
