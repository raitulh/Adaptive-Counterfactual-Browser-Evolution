import { describe, expect, it } from "vitest";
import {
  approvalStatusValues,
  connectionStatusValues,
  stepStatusValues,
  taskStatusValues,
  verificationStatusValues,
} from "@/lib/api";
import {
  approvalStatusMeta,
  connectionStatusMeta,
  isTaskActive,
  stepStatusMeta,
  taskControls,
  taskStatusMeta,
  toneClasses,
  verificationStatusMeta,
} from "@/lib/status";

describe("status presentation covers every backend value", () => {
  it.each([
    ["TaskStatus", taskStatusValues, taskStatusMeta],
    ["StepStatus", stepStatusValues, stepStatusMeta],
    ["VerificationStatus", verificationStatusValues, verificationStatusMeta],
    ["ApprovalStatus", approvalStatusValues, approvalStatusMeta],
    ["ConnectionStatus", connectionStatusValues, connectionStatusMeta],
  ] as const)("%s", (_name, values, meta) => {
    expect(Object.keys(meta).sort()).toEqual([...values].sort());
    for (const v of values) {
      const m = (meta as Record<string, { label: string; tone: keyof typeof toneClasses }>)[v]!;
      expect(m.label.length).toBeGreaterThan(0);
      expect(toneClasses[m.tone]).toBeDefined();
    }
  });

  it("uses the fixed tone semantics for human-needed and verification states", () => {
    expect(taskStatusMeta.waiting_approval.tone).toBe("warning");
    expect(taskStatusMeta.waiting_input.tone).toBe("warning");
    expect(taskStatusMeta.verifying.tone).toBe("verify");
    expect(taskStatusMeta.recovering.tone).toBe("recover");
    expect(taskStatusMeta.failed.tone).toBe("danger");
  });
});

describe("taskControls mirrors the backend's allowed transitions", () => {
  it("never offers cancel on terminal or already-cancelling tasks", () => {
    expect(taskControls("completed", 1).cancel).toBe(false);
    expect(taskControls("cancelled", 1).cancel).toBe(false);
    expect(taskControls("cancel_requested", 1).cancel).toBe(false);
    expect(taskControls("running", 1).cancel).toBe(true);
    expect(taskControls("failed", 1).cancel).toBe(true);
  });

  it("pauses only states the backend can pause", () => {
    const pausable = taskStatusValues.filter((s) => taskControls(s, 1).pause);
    expect(pausable.sort()).toEqual(["queued", "recovering", "running", "verifying", "waiting_approval"]);
  });

  it("resumes planned work, and re-plans failed/blocked tasks without a plan", () => {
    expect(taskControls("paused", 1).resume).toBe(true);
    expect(taskControls("paused", 0).resume).toBe(false);
    expect(taskControls("expired", 0).resume).toBe(false);
    expect(taskControls("failed", 0).resume).toBe(true);
    expect(taskControls("blocked", 0).resume).toBe(true);
    expect(taskControls("running", 1).resume).toBe(false);
  });

  it("offers input and confirmation only in their states", () => {
    expect(taskStatusValues.filter((s) => taskControls(s, 1).provideInput)).toEqual(["waiting_input"]);
    expect(taskStatusValues.filter((s) => taskControls(s, 1).confirmOutcome)).toEqual(["requires_reconciliation"]);
  });

  it("marks only in-flight work as active", () => {
    expect(isTaskActive("running")).toBe(true);
    expect(isTaskActive("completed")).toBe(false);
    expect(isTaskActive("waiting_approval")).toBe(false);
  });
});
