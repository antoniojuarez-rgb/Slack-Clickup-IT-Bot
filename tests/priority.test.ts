/**
 * Unit tests: priority mapping
 */

import { describe, it, expect } from "vitest";
import {
  priorityMap,
  slackPriorityToClickUp,
  isHighPriority,
  CLICKUP_PRIORITY,
} from "../lib/priority.js";

describe("priority mapping", () => {
  it("maps 'High (Within 1 hours)' to 2", () => {
    expect(priorityMap["High (Within 1 hours)"]).toBe(2);
    expect(slackPriorityToClickUp("High (Within 1 hours)")).toBe(CLICKUP_PRIORITY.HIGH);
  });

  it("maps 'Medium (Within 4-8 hours)' to 3", () => {
    expect(priorityMap["Medium (Within 4-8 hours)"]).toBe(3);
    expect(slackPriorityToClickUp("Medium (Within 4-8 hours)")).toBe(CLICKUP_PRIORITY.NORMAL);
  });

  it("maps 'Low (Within 24hrs)' to 4", () => {
    expect(priorityMap["Low (Within 24hrs)"]).toBe(4);
    expect(slackPriorityToClickUp("Low (Within 24hrs)")).toBe(CLICKUP_PRIORITY.LOW);
  });

  it("defaults unknown to Normal (3)", () => {
    expect(slackPriorityToClickUp("")).toBe(3);
    expect(slackPriorityToClickUp("Unknown")).toBe(3);
  });

  it("trims whitespace", () => {
    expect(slackPriorityToClickUp("  High (Within 1 hours)  ")).toBe(2);
  });
});

describe("isHighPriority", () => {
  it("returns true for 'High (Within 1 hours)'", () => {
    expect(isHighPriority("High (Within 1 hours)")).toBe(true);
  });

  it("returns false for Medium and Low", () => {
    expect(isHighPriority("Medium (Within 4-8 hours)")).toBe(false);
    expect(isHighPriority("Low (Within 24hrs)")).toBe(false);
  });
});
