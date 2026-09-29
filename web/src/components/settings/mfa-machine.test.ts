import { describe, expect, it } from "vitest";
import {
  formatSecret,
  initialMfaState,
  isCompleteTotp,
  mfaReducer,
  normalizeTotp,
  type MfaEvent,
  type MfaState,
} from "./mfa-machine";

const enrollment = {
  factor_id: "f-1",
  secret: "JBSWY3DPEHPK3PXP",
  otpauth_uri: "otpauth://totp/AgentOS:a@b.com?secret=JBSWY3DPEHPK3PXP",
};

function run(state: MfaState, ...events: MfaEvent[]): MfaState {
  return events.reduce(mfaReducer, state);
}

describe("MFA state machine", () => {
  it("starts from the server's mfa_enabled flag", () => {
    expect(initialMfaState(false)).toEqual({ phase: "disabled", error: null });
    expect(initialMfaState(true)).toEqual({ phase: "enabled", justEnabled: false });
  });

  it("walks the happy enrollment path: start → enrolled → submit → confirmed", () => {
    const s = run(initialMfaState(false), { type: "START" }, { type: "ENROLLED", enrollment });
    expect(s).toEqual({ phase: "verifying", enrollment, submitting: false, error: null });
    const submitting = mfaReducer(s, { type: "SUBMIT" });
    expect(submitting).toMatchObject({ phase: "verifying", submitting: true });
    expect(mfaReducer(submitting, { type: "CONFIRMED" })).toEqual({ phase: "enabled", justEnabled: true });
  });

  it("keeps the QR code and shows the error when the code is rejected", () => {
    const err = new Error("Invalid verification code");
    const s = run(
      initialMfaState(false),
      { type: "START" },
      { type: "ENROLLED", enrollment },
      { type: "SUBMIT" },
      { type: "CODE_REJECTED", error: err },
    );
    expect(s).toEqual({ phase: "verifying", enrollment, submitting: false, error: err });
    // Resubmitting clears the previous error.
    expect(mfaReducer(s, { type: "SUBMIT" })).toMatchObject({ submitting: true, error: null });
  });

  it("returns to disabled with the error when enrollment fails", () => {
    const err = new Error("boom");
    expect(run(initialMfaState(false), { type: "START" }, { type: "ENROLL_FAILED", error: err })).toEqual({
      phase: "disabled",
      error: err,
    });
  });

  it("can cancel verification, but not while a code is being submitted", () => {
    const verifying = run(initialMfaState(false), { type: "START" }, { type: "ENROLLED", enrollment });
    expect(mfaReducer(verifying, { type: "CANCEL" })).toEqual({ phase: "disabled", error: null });
    const submitting = mfaReducer(verifying, { type: "SUBMIT" });
    expect(mfaReducer(submitting, { type: "CANCEL" })).toBe(submitting);
  });

  it("disables with a code, keeps the dialog open on a wrong code, and can be cancelled", () => {
    const disabling = run(initialMfaState(true), { type: "START_DISABLE" });
    expect(disabling).toEqual({ phase: "disabling", submitting: false, error: null });
    const err = new Error("Invalid verification code");
    const rejected = run(disabling, { type: "SUBMIT" }, { type: "DISABLE_REJECTED", error: err });
    expect(rejected).toEqual({ phase: "disabling", submitting: false, error: err });
    expect(mfaReducer(rejected, { type: "CANCEL" })).toEqual({ phase: "enabled", justEnabled: false });
    expect(run(disabling, { type: "SUBMIT" }, { type: "DISABLED" })).toEqual({ phase: "disabled", error: null });
  });

  it("ignores events that don't apply to the current phase", () => {
    const disabled = initialMfaState(false);
    for (const e of [
      { type: "CONFIRMED" },
      { type: "DISABLED" },
      { type: "SUBMIT" },
      { type: "START_DISABLE" },
      { type: "CODE_REJECTED", error: null },
    ] as MfaEvent[]) {
      expect(mfaReducer(disabled, e)).toBe(disabled);
    }
    const enabled = initialMfaState(true);
    expect(mfaReducer(enabled, { type: "START" })).toBe(enabled);
    expect(mfaReducer(enabled, { type: "ENROLLED", enrollment })).toBe(enabled);
  });

  it("follows the server in resting states but never interrupts a flow in progress", () => {
    expect(mfaReducer(initialMfaState(false), { type: "SYNC", enabled: true })).toEqual({
      phase: "enabled",
      justEnabled: false,
    });
    expect(mfaReducer(initialMfaState(true), { type: "SYNC", enabled: false })).toEqual({
      phase: "disabled",
      error: null,
    });
    const verifying = run(initialMfaState(false), { type: "START" }, { type: "ENROLLED", enrollment });
    expect(mfaReducer(verifying, { type: "SYNC", enabled: false })).toBe(verifying);
    const disabling = run(initialMfaState(true), { type: "START_DISABLE" });
    expect(mfaReducer(disabling, { type: "SYNC", enabled: true })).toBe(disabling);
    // After a successful confirm, a refetch saying "enabled" keeps the success message.
    const justEnabled = mfaReducer(mfaReducer(verifying, { type: "SUBMIT" }), { type: "CONFIRMED" });
    expect(mfaReducer(justEnabled, { type: "SYNC", enabled: true })).toBe(justEnabled);
  });
});

describe("TOTP input helpers", () => {
  it("keeps digits only, max six", () => {
    expect(normalizeTotp("123 456")).toBe("123456");
    expect(normalizeTotp("12a3-45678")).toBe("123456");
    expect(isCompleteTotp("123456")).toBe(true);
    expect(isCompleteTotp("12345")).toBe(false);
  });
  it("groups the secret for manual entry", () => {
    expect(formatSecret("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
  });
});
