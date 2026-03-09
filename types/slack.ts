/**
 * Slack workflow form payload and interaction types
 */

export interface SlackWorkflowPayload {
  type?: string;
  workflow_step?: {
    workflow_step_edit_id?: string;
    workflow_id?: string;
    step_id?: string;
    inputs?: Record<string, { value: string }>;
  };
  /** Incoming webhook from workflow - may have different shape */
  requester?: string;
  description?: string;
  priority?: string;
  type_of_request?: string;
  troubleshooting_steps?: string;
  /** Raw payload for form submissions */
  [key: string]: unknown;
}

export interface SlackBlockActionPayload {
  type: "block_actions";
  user: { id: string; username?: string; name?: string };
  channel?: { id: string };
  message?: { ts: string; blocks?: unknown[] };
  actions: Array<{
    action_id: string;
    block_id?: string;
    value?: string;
  }>;
  response_url?: string;
  trigger_id?: string;
}

export interface SlackInteractionPayload {
  payload?: string; // JSON string when sent as form-urlencoded
  type?: string;
  user?: { id: string; username?: string; name?: string };
  actions?: Array<{ action_id: string; value?: string }>;
  message?: { ts: string };
  channel?: { id: string };
}

export interface SlackMessageBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: unknown[];
  block_id?: string;
  [key: string]: unknown;
}

export type SlackPriority = "Low" | "Medium" | "High" | "Critical";
