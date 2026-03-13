/**
 * ClickUp API client: create task, get task (for custom_id), update assignees.
 */

import type {
  ClickUpCreateTaskPayload,
  ClickUpCreateTaskResponse,
  ClickUpTaskResponse,
  ClickUpUpdateTaskPayload,
} from "../types/clickup.js";

const CLICKUP_BASE = "https://api.clickup.com/api/v2";

function getHeaders(): Record<string, string> {
  const key = process.env.CLICKUP_API_KEY;
  if (!key) throw new Error("CLICKUP_API_KEY is not set");
  return {
    "Content-Type": "application/json",
    Authorization: key,
  };
}

export async function createTask(
  listId: string,
  payload: ClickUpCreateTaskPayload
): Promise<ClickUpCreateTaskResponse> {
  const res = await fetch(`${CLICKUP_BASE}/list/${listId}/task`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickUp create task failed: ${res.status} ${text}`);
  }

  return (await res.json()) as ClickUpCreateTaskResponse;
}

export async function getTask(taskId: string): Promise<ClickUpTaskResponse> {
  const res = await fetch(`${CLICKUP_BASE}/task/${taskId}`, {
    method: "GET",
    headers: getHeaders(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickUp get task failed: ${res.status} ${text}`);
  }

  return (await res.json()) as ClickUpTaskResponse;
}

export async function updateTask(
  taskId: string,
  payload: ClickUpUpdateTaskPayload
): Promise<ClickUpTaskResponse> {
  const res = await fetch(`${CLICKUP_BASE}/task/${taskId}`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify({
      assignees: { add: payload.assignees?.add ?? [] },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickUp update task failed: ${res.status} ${text}`);
  }

  return (await res.json()) as ClickUpTaskResponse;
}

export async function postComment(taskId: string, commentText: string): Promise<void> {
  const res = await fetch(`${CLICKUP_BASE}/task/${taskId}/comment`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ comment_text: commentText, notify_all: false }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickUp comment failed: ${res.status} ${text}`);
  }
}

export async function closeTask(taskId: string): Promise<ClickUpTaskResponse> {
  const res = await fetch(`${CLICKUP_BASE}/task/${taskId}`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify({ status: "complete" }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickUp close task failed: ${res.status} ${text}`);
  }

  return (await res.json()) as ClickUpTaskResponse;
}

export function getTaskUrl(taskId: string): string {
  return `https://app.clickup.com/t/${taskId}`;
}
