/**
 * In-memory store: Slack thread_ts → ClickUp task_id
 */

const store = new Map<string, string>();

export function saveThreadMapping(threadTs: string, taskId: string): void {
  store.set(threadTs, taskId);
}

export function getTaskIdForThread(threadTs: string): string | undefined {
  return store.get(threadTs);
}
