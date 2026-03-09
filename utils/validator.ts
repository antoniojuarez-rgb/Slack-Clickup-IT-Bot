/**
 * Request payload validation
 */

export const REQUIRED_WORKFLOW_FIELDS = [
  "requester",
  "priority",
  "description",
  "type_of_request",
] as const;

export type WorkflowPayload = Record<string, unknown>;

export function validateWorkflowPayload(payload: WorkflowPayload): {
  valid: boolean;
  missing: string[];
} {
  const fields = getWorkflowFields(payload);
  const missing = REQUIRED_WORKFLOW_FIELDS.filter(
    (f) => !(fields[f as keyof typeof fields]?.length > 0)
  );
  return {
    valid: missing.length === 0,
    missing: [...missing],
  };
}

function getValue(payload: WorkflowPayload, key: string): string {
  const flat = payload[key];
  if (flat !== undefined && flat !== null) return String(flat).trim();
  const inputs = payload.workflow_step as Record<string, Record<string, { value?: string }>> | undefined;
  const val = inputs?.inputs?.[key]?.value;
  return val !== undefined && val !== null ? String(val).trim() : "";
}

export function getWorkflowFields(payload: WorkflowPayload): {
  requester: string;
  description: string;
  priority: string;
  type_of_request: string;
  troubleshooting_steps: string;
} {
  return {
    requester: getValue(payload, "requester"),
    description: getValue(payload, "description"),
    priority: getValue(payload, "priority") || "Medium",
    type_of_request: getValue(payload, "type_of_request"),
    troubleshooting_steps: getValue(payload, "troubleshooting_steps"),
  };
}
