/**
 * Two-step verification (TOTP) enrollment/disable flow as a pure state machine.
 *
 *   disabled ──START──▶ enrolling ──ENROLLED──▶ verifying ──SUBMIT──▶ (submitting) ──CONFIRMED──▶ enabled
 *                 ▲          │ENROLL_FAILED          │CANCEL                  │CODE_REJECTED → verifying + error
 *                 └──────────┴───────────────────────┘
 *   enabled ──START_DISABLE──▶ disabling ──SUBMIT──▶ (submitting) ──DISABLED──▶ disabled
 *                                   │CANCEL → enabled        │DISABLE_REJECTED → disabling + error
 *
 * The server (`MeOut.mfa_enabled`) is the source of truth: SYNC moves resting states to match it but
 * never interrupts a flow in progress (so a refetch can't discard a QR code the user is scanning).
 */
import type { MfaEnrollResponse } from "@/lib/api";

export type MfaState =
  | { phase: "disabled"; error: unknown }
  | { phase: "enrolling" }
  | { phase: "verifying"; enrollment: MfaEnrollResponse; submitting: boolean; error: unknown }
  | { phase: "enabled"; justEnabled: boolean }
  | { phase: "disabling"; submitting: boolean; error: unknown };

export type MfaEvent =
  | { type: "SYNC"; enabled: boolean }
  | { type: "START" }
  | { type: "ENROLLED"; enrollment: MfaEnrollResponse }
  | { type: "ENROLL_FAILED"; error: unknown }
  | { type: "SUBMIT" }
  | { type: "CODE_REJECTED"; error: unknown }
  | { type: "CONFIRMED" }
  | { type: "START_DISABLE" }
  | { type: "DISABLE_REJECTED"; error: unknown }
  | { type: "DISABLED" }
  | { type: "CANCEL" };

export function initialMfaState(enabled: boolean): MfaState {
  return enabled ? { phase: "enabled", justEnabled: false } : { phase: "disabled", error: null };
}

export function mfaReducer(state: MfaState, event: MfaEvent): MfaState {
  switch (event.type) {
    case "SYNC":
      if (state.phase === "disabled" && event.enabled) return { phase: "enabled", justEnabled: false };
      if (state.phase === "enabled" && !event.enabled) return { phase: "disabled", error: null };
      return state;
    case "START":
      return state.phase === "disabled" ? { phase: "enrolling" } : state;
    case "ENROLLED":
      return state.phase === "enrolling"
        ? { phase: "verifying", enrollment: event.enrollment, submitting: false, error: null }
        : state;
    case "ENROLL_FAILED":
      return state.phase === "enrolling" ? { phase: "disabled", error: event.error } : state;
    case "SUBMIT":
      if (state.phase === "verifying" || state.phase === "disabling") {
        return state.submitting ? state : { ...state, submitting: true, error: null };
      }
      return state;
    case "CODE_REJECTED":
      return state.phase === "verifying" ? { ...state, submitting: false, error: event.error } : state;
    case "CONFIRMED":
      return state.phase === "verifying" ? { phase: "enabled", justEnabled: true } : state;
    case "START_DISABLE":
      return state.phase === "enabled" ? { phase: "disabling", submitting: false, error: null } : state;
    case "DISABLE_REJECTED":
      return state.phase === "disabling" ? { ...state, submitting: false, error: event.error } : state;
    case "DISABLED":
      return state.phase === "disabling" ? { phase: "disabled", error: null } : state;
    case "CANCEL":
      if (state.phase === "verifying" && !state.submitting) return { phase: "disabled", error: null };
      if (state.phase === "disabling" && !state.submitting) return { phase: "enabled", justEnabled: false };
      return state;
  }
}

/** Keep only digits (authenticator apps often display "123 456"); at most 6. */
export function normalizeTotp(input: string): string {
  return input.replace(/\D+/g, "").slice(0, 6);
}

export function isCompleteTotp(code: string): boolean {
  return /^\d{6}$/.test(code);
}

/** Group a base32 secret in blocks of four for manual entry ("JBSW Y3DP …"). */
export function formatSecret(secret: string): string {
  return secret.replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ");
}
