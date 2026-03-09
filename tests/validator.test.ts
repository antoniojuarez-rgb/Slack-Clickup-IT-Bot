/**
 * Unit tests: workflow payload validation
 */

import { describe, it, expect } from "vitest";
import {
  validateWorkflowPayload,
  getWorkflowFields,
  REQUIRED_WORKFLOW_FIELDS,
} from "../utils/validator.js";

describe("validateWorkflowPayload", () => {
  it("valid when all required fields present", () => {
    const payload = {
      requester: "@user",
      priority: "High",
      description: "Need access",
      type_of_request: "Access Request",
    };
    const { valid, missing } = validateWorkflowPayload(payload);
    expect(valid).toBe(true);
    expect(missing).toHaveLength(0);
  });

  it("invalid when field missing", () => {
    const payload = {
      requester: "@user",
      priority: "High",
      description: "Need access",
    };
    const { valid, missing } = validateWorkflowPayload(payload);
    expect(valid).toBe(false);
    expect(missing).toContain("type_of_request");
  });

  it("invalid when required field empty string", () => {
    const payload = {
      requester: "@user",
      priority: "High",
      description: " ",
      type_of_request: "Access Request",
    };
    const { valid } = validateWorkflowPayload(payload);
    expect(valid).toBe(false);
  });
});

describe("getWorkflowFields", () => {
  it("reads flat payload", () => {
    const payload = {
      requester: "@user",
      description: "Desc",
      priority: "Medium",
      type_of_request: "Access",
      troubleshooting_steps: "None",
    };
    const f = getWorkflowFields(payload);
    expect(f.requester).toBe("@user");
    expect(f.description).toBe("Desc");
    expect(f.priority).toBe("Medium");
    expect(f.type_of_request).toBe("Access");
    expect(f.troubleshooting_steps).toBe("None");
  });

  it("reads workflow_step.inputs format", () => {
    const payload = {
      workflow_step: {
        inputs: {
          requester: { value: "@alice" },
          description: { value: "Need Tableau" },
          priority: { value: "High" },
          type_of_request: { value: "Access Request" },
          troubleshooting_steps: { value: "n/a" },
        },
      },
    };
    const f = getWorkflowFields(payload);
    expect(f.requester).toBe("@alice");
    expect(f.priority).toBe("High");
  });
});
