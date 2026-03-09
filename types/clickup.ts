/**
 * ClickUp API request/response types
 */

export interface ClickUpCreateTaskPayload {
  name: string;
  description: string;
  priority: number; // 1=Urgent, 2=High, 3=Normal, 4=Low
  custom_task_ids?: boolean;
  team_id?: number;
}

export interface ClickUpCreateTaskResponse {
  id: string;
  custom_id: string | null;
  name: string;
  status?: { status: string };
  priority?: { priority: string; id: number };
  [key: string]: unknown;
}

export interface ClickUpTaskResponse {
  id: string;
  custom_id: string | null;
  name: string;
  description?: string;
  status?: { status: string };
  priority?: { priority: string; id: number };
  [key: string]: unknown;
}

export interface ClickUpUpdateTaskPayload {
  assignees?: { add: number[] };
}
