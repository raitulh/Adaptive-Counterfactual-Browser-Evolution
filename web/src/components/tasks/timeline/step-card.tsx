"use client";

/**
 * A plan step with everything a person needs to trust it: what it does, which tool (and version),
 * its permission and risk, approval and verification state, attempts, duration, result, error and
 * the external reference it produced. Execution state and verification state are shown separately
 * (verification = violet ring). Pure: data comes from props.
 */
import {
  AlertTriangleIcon,
  ExternalLinkIcon,
  HandIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  ShieldQuestionIcon,
  TimerIcon,
} from "lucide-react";
import { createElement } from "react";
import type { StepOut, VerificationOut } from "@/lib/api";
import { PermissionBadge, RiskBadge, StatusBadge } from "@/components/ui/badge";
import { duration, humanizeTool } from "@/lib/format";
import { stepStatusMeta, toneClasses, verificationStatusMeta } from "@/lib/status";
import { cn } from "@/lib/utils";
import { errorLabel, verificationMethodLabel } from "./normalize";
import { toolIcon } from "./tool-meta";
import { readable } from "./readable";

export type StepCardStep = Pick<
  StepOut,
  | "id"
  | "position"
  | "action"
  | "tool_name"
  | "tool_version"
  | "status"
  | "permission_level"
  | "risk_level"
  | "requires_approval"
  | "verification_status"
  | "verification_method"
  | "attempt_count"
  | "started_at"
  | "completed_at"
  | "output_summary"
  | "error_class"
  | "error_message"
  | "external_ref"
> &
  Partial<Pick<StepOut, "approval_request_id" | "policy_reasons" | "step_key">>;

export interface StepCardProps {
  step: StepCardStep;
  /** Latest verification record for this step (evidence + method). */
  verification?: Pick<VerificationOut, "status" | "method" | "differences"> | null;
  /** Number of steps in the plan (for "Step 2 of 4"). */
  total?: number;
  /** Show ids / raw codes. */
  developerMode?: boolean;
  /** Emphasize (e.g. the step that needs attention). */
  highlighted?: boolean;
  className?: string;
}

function approvalState(
  step: StepCardStep,
): { label: string; tone: "warning" | "success" | "danger" | "neutral" } | null {
  if (!step.requires_approval) return null;
  if (step.status === "waiting_approval") return { label: "Waiting for your approval", tone: "warning" };
  if (step.error_class === "policy_blocked" && step.status === "failed") return { label: "Rejected", tone: "danger" };
  if (
    ["running", "waiting_external", "verifying", "completed", "retry_scheduled", "requires_reconciliation"].includes(
      step.status,
    )
  )
    return { label: "Approved", tone: "success" };
  return { label: "Requires approval", tone: "neutral" };
}

export function StepCard({
  step,
  verification,
  total,
  developerMode = false,
  highlighted = false,
  className,
}: StepCardProps) {
  const meta = stepStatusMeta[step.status];
  const running = step.status === "running" || step.status === "waiting_external";
  const verifying = step.status === "verifying";
  const approval = approvalState(step);
  const vStatus = verification?.status ?? step.verification_status;
  const vMeta = verificationStatusMeta[vStatus];
  const method = verification?.method ?? step.verification_method;
  const differences = (verification?.differences ?? [])
    .map((d) => (typeof d?.field === "string" ? d.field : null))
    .filter((f): f is string => Boolean(f));
  const took = step.started_at ? duration(step.started_at, step.completed_at ?? undefined) : null;

  return (
    <article
      className={cn(
        "relative rounded-xl border bg-surface-1 p-4 transition-colors",
        highlighted ? toneClasses[meta.tone].border : "border-line",
        verifying && "ring-1 ring-verify/40",
        className,
      )}
      aria-label={`Step ${step.position + 1}: ${step.action} — ${meta.label}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "relative flex size-9 shrink-0 items-center justify-center rounded-lg border",
            toneClasses[meta.tone].border,
            toneClasses[meta.tone].soft,
            toneClasses[meta.tone].text,
          )}
          aria-hidden
        >
          {running && <span className="absolute inset-0 rounded-lg bg-accent/25 motion-safe:animate-pulse-ring" />}
          {verifying && (
            <svg viewBox="0 0 40 40" className="absolute -inset-1 size-11 text-verify motion-safe:animate-spin-slow">
              <rect
                x="1.5"
                y="1.5"
                width="37"
                height="37"
                rx="10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="8 6"
              />
            </svg>
          )}
          {createElement(toolIcon(step.tool_name), { className: "relative size-4" })}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-2xs text-fg-subtle">
              Step {step.position + 1}
              {total ? ` of ${total}` : ""}
            </span>
            <StatusBadge kind="step" value={step.status} />
          </div>
          <h4 className="mt-1 text-sm leading-snug font-medium text-fg">{step.action}</h4>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
            {humanizeTool(step.tool_name)}
            <code className="font-mono text-2xs text-fg-subtle">
              {step.tool_name}@{step.tool_version}
            </code>
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <PermissionBadge level={step.permission_level} />
        <RiskBadge level={step.risk_level} />
        {approval && (
          <span
            className={cn(
              "inline-flex h-5 items-center gap-1 rounded-full border px-2 text-2xs font-medium",
              toneClasses[approval.tone].border,
              toneClasses[approval.tone].text,
            )}
          >
            <HandIcon className="size-3" aria-hidden />
            {approval.label}
          </span>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-fg-subtle">Verification</dt>
          <dd className={cn("mt-0.5 flex items-center gap-1 font-medium", toneClasses[vMeta.tone].text)}>
            {vStatus === "passed" ? (
              <ShieldCheckIcon className="size-3.5" aria-hidden />
            ) : (
              <ShieldQuestionIcon className="size-3.5" aria-hidden />
            )}
            {verifying ? "Verifying now" : vMeta.label}
          </dd>
          {method && vStatus !== "not_applicable" && (
            <dd className="mt-0.5 text-2xs text-fg-subtle">{verificationMethodLabel(method)}</dd>
          )}
        </div>
        <div>
          <dt className="text-fg-subtle">Attempts</dt>
          <dd className="mt-0.5 flex items-center gap-1 font-medium text-fg tabular-nums">
            {step.attempt_count > 1 && <RotateCcwIcon className="size-3 text-recover" aria-hidden />}
            {step.attempt_count}
          </dd>
        </div>
        <div>
          <dt className="text-fg-subtle">Duration</dt>
          <dd className="mt-0.5 flex items-center gap-1 font-medium text-fg tabular-nums">
            <TimerIcon className="size-3 text-fg-subtle" aria-hidden />
            {took ?? "—"}
          </dd>
        </div>
      </dl>

      {step.output_summary && (
        <p className="mt-3 rounded-lg bg-surface-2/70 px-3 py-2 text-[13px] leading-relaxed text-fg">
          {readable(step.output_summary)}
        </p>
      )}
      {(step.error_message || step.error_class) && !["completed"].includes(step.status) && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-[13px] text-fg">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium text-danger">{errorLabel(step.error_class)}</p>
            {step.error_message && (
              <p className="mt-0.5 leading-relaxed text-fg-muted">{readable(step.error_message)}</p>
            )}
          </div>
        </div>
      )}
      {differences.length > 0 && (
        <p className="mt-2 text-xs text-fg-muted">
          Verification found differences in <span className="text-fg">{differences.join(", ")}</span>.
        </p>
      )}
      {step.external_ref && (
        <p className="mt-2 flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-fg-subtle">
          <ExternalLinkIcon className="size-3 shrink-0" aria-hidden />
          External reference <code className="truncate font-mono text-2xs text-fg-muted">{step.external_ref}</code>
        </p>
      )}
      {developerMode && (
        <p className="mt-2 font-mono text-2xs text-fg-subtle">
          {step.step_key && <>key {step.step_key} · </>}id {step.id}
          {step.error_class && <> · error_class {step.error_class}</>}
          {step.policy_reasons && step.policy_reasons.length > 0 && <> · policy: {step.policy_reasons.join("; ")}</>}
        </p>
      )}
    </article>
  );
}
