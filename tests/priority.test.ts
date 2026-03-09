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
  it("maps Critical to 1", () => {
    expect(priorityMap.Critical).toBe(1);
    expect(slackPriorityToClickUp("Critical")).toBe(CLICKUP_PRIORITY.URGENT);
  });

  it("maps High to 2", () => {
    expect(priorityMap.High).toBe(2);
    expect(slackPriorityToClickUp("High")).toBe(CLICKUP_PRIORITY.HIGH);
  });

  it("maps Medium to 3", () => {
    expect(priorityMap.Medium).toBe(3);
    expect(slackPriorityToClickUp("Medium")).toBe(CLICKUP_PRIORITY.NORMAL);
  });

  it("maps Low to 4", () => {
    expect(priorityMap.Low).toBe(4);
    expect(slackPriorityToClickUp("Low")).toBe(CLICKUP_PRIORITY.LOW);
  });

  it("defaults unknown to Normal (3)", () => {
    expect(slackPriorityToClickUp("")).toBe(3);
    expect(slackPriorityToClickUp("Unknown")).toBe(3);
  });

  it("trims whitespace", () => {
    expect(slackPriorityToClickUp("  High  ")).toBe(2);
  });
});

describe("isHighPriority", () => {
  it("returns true for High and Critical", () => {
    expect(isHighPriority("High")).toBe(true);
    expect(isHighPriority("Critical")).toBe(true);
  });

  it("returns false for Medium and Low", () => {
    expect(isHighPriority("Medium")).toBe(false);
    expect(isHighPriority("Low")).toBe(false);
  });
});
