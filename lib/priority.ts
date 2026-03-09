/**
 * Priority mapping: Slack form values → ClickUp priority IDs
 */

export const priorityMap: Record<string, number> = {
  "High (Within 1 hours)": 2,
  "Medium (Within 4-8 hours)": 3,
  "Low (Within 24hrs)": 4,
} as const;

export const CLICKUP_PRIORITY = {
  URGENT: 1,
  HIGH: 2,
  NORMAL: 3,
  LOW: 4,
} as const;

export function slackPriorityToClickUp(priority: string): number {
  const normalized = priority?.trim() || "";
  return priorityMap[normalized] ?? CLICKUP_PRIORITY.NORMAL;
}

export function isHighPriority(priority: string): boolean {
  return priority?.trim() === "High (Within 1 hours)";
}
