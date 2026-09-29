/**
 * Approval decision rules (pure). The backend is authoritative (it re-checks status, expiry and
 * permissions); these rules decide how deliberate the UI makes the human decision.
 *
 *  - low / medium risk with an ordinary permission → approve directly from the card (which already
 *    restates the action, target and arguments);
 *  - high risk, or a destructive / financial / admin permission → a confirmation dialog that
 *    restates exactly what will happen;
 *  - critical risk → the same dialog plus type-to-confirm.
 *  - rejecting always asks for a reason (the backend requires one).
 */
import type { ApprovalOut, PermissionLevel, RiskLevel } from "@/lib/api";
import { permissionLevelMeta, riskLevelMeta } from "@/lib/status";

export type ConfirmationMode = "none" | "confirm" | "type";

const RANK: Record<ConfirmationMode, number> = { none: 0, confirm: 1, type: 2 };

export function approvalConfirmationMode(risk: RiskLevel, permission?: PermissionLevel | null): ConfirmationMode {
  const riskRank = riskLevelMeta[risk]?.rank ?? 3;
  let mode: ConfirmationMode = riskRank >= 3 ? "type" : riskRank >= 2 ? "confirm" : "none";
  if (permission && (permissionLevelMeta[permission]?.rank ?? 0) >= 3 && RANK[mode] < RANK.confirm) mode = "confirm";
  return mode;
}

/** What the user types to approve a critical action: the exact tool, so they read what it is. */
export function typeToConfirmPhrase(approval: Pick<ApprovalOut, "tool_name">): string {
  return approval.tool_name;
}

export type DecisionBlock = "expired" | "not_pending" | null;

/** Whether a decision can still be made (UI hint only; the backend decides). */
export function decisionBlock(approval: Pick<ApprovalOut, "status" | "expires_at">, now: number = Date.now()): DecisionBlock {
  if (approval.status !== "pending") return "not_pending";
  const expires = new Date(approval.expires_at).getTime();
  if (Number.isFinite(expires) && expires <= now) return "expired";
  return null;
}

export const REJECT_REASON_MAX = 1000;

/** Validation message for a rejection reason, or null when valid (mirrors backend: 1–1000 chars). */
export function rejectReasonError(reason: string): string | null {
  const trimmed = reason.trim();
  if (!trimmed) return "Tell AgentOS why, so it can adjust the plan.";
  if (trimmed.length > REJECT_REASON_MAX) return `Keep the reason under ${REJECT_REASON_MAX} characters.`;
  return null;
}

/** "in 4 min" style remaining time; "expired" when past. */
export function remainingLabel(expiresAt: string, now: number = Date.now()): { label: string; expired: boolean; urgent: boolean } {
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms)) return { label: "—", expired: false, urgent: false };
  if (ms <= 0) return { label: "Expired", expired: true, urgent: false };
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const label = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : m > 0 ? `${m}m ${String(sec).padStart(2, "0")}s` : `${sec}s`;
  return { label: `Expires in ${label}`, expired: false, urgent: ms < 5 * 60_000 };
}
