/**
 * Priority mapping: Slack form values → ClickUp priority IDs
 */

export const priorityMap: Record<string, number> = {
  Critical: 1,
  High: 2,
  Medium: 3,
  Low: 4,
} as const;

export const CLICKUP_PRIORITY = {
  URGENT: 1,
  HIGH: 2,
  NORMAL: 3,
  LOW: 4,
} as const;

export function slackPriorityToClickUp(priority: string): number {
  const normalized = priority?.trim() || "Medium";
  return priorityMap[normalized] ?? CLICKUP_PRIORITY.NORMAL;
}

export function isHighPriority(priority: string): boolean {
  return priority?.trim() === "High" || priority?.trim() === "Critical";
}
