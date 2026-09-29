import { describe, expect, it } from "vitest";
import {
  approvalConfirmationMode,
  decisionBlock,
  rejectReasonError,
  remainingLabel,
  typeToConfirmPhrase,
} from "./decision";

describe("approvalConfirmationMode", () => {
  it("lets low and medium risk be approved from the card", () => {
    expect(approvalConfirmationMode("low", "write")).toBe("none");
    expect(approvalConfirmationMode("medium", "write")).toBe("none");
  });

  it("requires a deliberate confirmation for high risk", () => {
    expect(approvalConfirmationMode("high", "write")).toBe("confirm");
    expect(approvalConfirmationMode("high", "high_risk_write")).toBe("confirm");
  });

  it("requires type-to-confirm for critical risk", () => {
    expect(approvalConfirmationMode("critical", "write")).toBe("type");
    expect(approvalConfirmationMode("critical", "financial")).toBe("type");
  });

  it("escalates destructive, financial and admin permissions even at low risk", () => {
    expect(approvalConfirmationMode("low", "destructive")).toBe("confirm");
    expect(approvalConfirmationMode("medium", "financial")).toBe("confirm");
    expect(approvalConfirmationMode("low", "admin")).toBe("confirm");
    expect(approvalConfirmationMode("low", "read")).toBe("none");
  });

  it("asks the user to type the exact tool for critical actions", () => {
    expect(typeToConfirmPhrase({ tool_name: "payments.transfer" })).toBe("payments.transfer");
  });
});

describe("decisionBlock", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  it("blocks decisions on expired or already-decided approvals", () => {
    expect(decisionBlock({ status: "pending", expires_at: "2026-09-29T12:05:00Z" }, now)).toBeNull();
    expect(decisionBlock({ status: "pending", expires_at: "2026-09-29T11:59:59Z" }, now)).toBe("expired");
    expect(decisionBlock({ status: "approved", expires_at: "2026-09-30T00:00:00Z" }, now)).toBe("not_pending");
  });

  it("formats the countdown and flags urgency", () => {
    expect(remainingLabel("2026-09-29T12:03:05Z", now)).toEqual({
      label: "Expires in 3m 05s",
      expired: false,
      urgent: true,
    });
    expect(remainingLabel("2026-09-30T14:00:00Z", now)).toMatchObject({ label: "Expires in 1d 2h", urgent: false });
    expect(remainingLabel("2026-09-29T11:00:00Z", now)).toMatchObject({ label: "Expired", expired: true });
  });
});

describe("rejectReasonError", () => {
  it("requires a non-blank reason within the backend limit", () => {
    expect(rejectReasonError("   ")).toMatch(/why/);
    expect(rejectReasonError("Wrong recipient")).toBeNull();
    expect(rejectReasonError("x".repeat(1001))).toMatch(/1000/);
  });
});
