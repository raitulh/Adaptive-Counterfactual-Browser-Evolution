"use client";

import { CheckIcon, HandIcon, LockKeyholeIcon, XIcon } from "lucide-react";
import { ArgumentsPreview } from "@/components/approvals/arguments-preview";
import { PermissionBadge, RiskBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DemoApproval } from "@/lib/demo/task-event-source";
import { cn } from "@/lib/utils";

export interface DemoApprovalCardProps {
  approval: DemoApproval;
  deciding: "approve" | "reject" | null;
  onApprove: () => void;
  onReject: () => void;
  className?: string;
}

/**
 * The approval request as the product presents it (amber = waiting for a human): the exact action,
 * why it needs approval, the redacted arguments it is bound to, and the decision.
 */
export function DemoApprovalCard({ approval, deciding, onApprove, onReject, className }: DemoApprovalCardProps) {
  const minutes = Math.max(1, Math.round((Date.parse(approval.expires_at) - Date.parse(approval.created_at)) / 60_000));
  return (
    <section
      aria-labelledby="demo-approval-title"
      className={cn(
        "relative overflow-hidden rounded-xl border border-warning/35 bg-surface-1 shadow-[0_0_40px_-18px_rgb(245_184_74/0.55)]",
        className,
      )}
    >
      <div
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-warning/60 to-transparent"
        aria-hidden
      />
      <div className="flex flex-col gap-3.5 p-4">
        <div className="flex items-center gap-2">
          <span
            className="flex size-7 items-center justify-center rounded-lg border border-warning/35 bg-warning/10 text-warning"
            aria-hidden
          >
            <HandIcon className="size-3.5" />
          </span>
          <h3 id="demo-approval-title" className="text-[13px] font-semibold text-warning">
            Your approval is required
          </h3>
          <span className="ml-auto flex items-center gap-1.5">
            <PermissionBadge level={approval.permission_level} />
            <RiskBadge level={approval.risk_level} />
          </span>
        </div>
        <p className="text-[15px] leading-snug text-fg">{approval.summary}</p>
        {approval.reasons.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Why approval is needed">
            {approval.reasons.map((r) => (
              <li key={r} className="rounded-md border border-line bg-surface-2 px-2 py-0.5 text-xs text-fg-muted">
                {r}
              </li>
            ))}
          </ul>
        )}
        <details className="group rounded-lg border border-line bg-bg/40">
          <summary className="cursor-pointer list-none px-3 py-2 font-mono text-[11px] text-fg-subtle transition-colors hover:text-fg-muted">
            <span className="group-open:hidden">Show</span>
            <span className="hidden group-open:inline">Hide</span> exact arguments · {approval.tool_name}
          </summary>
          <div className="px-3 pb-3">
            <ArgumentsPreview args={approval.arguments_preview} />
          </div>
        </details>
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-fg-subtle">
          <LockKeyholeIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
          Bound to this exact action and these arguments · expires in {minutes} min · usable once
        </p>
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="md"
            className="flex-1"
            onClick={onApprove}
            loading={deciding === "approve"}
            disabled={deciding !== null}
          >
            {deciding !== "approve" && <CheckIcon aria-hidden />}
            Approve
          </Button>
          <Button
            variant="danger-outline"
            size="md"
            onClick={onReject}
            loading={deciding === "reject"}
            disabled={deciding !== null}
          >
            {deciding !== "reject" && <XIcon aria-hidden />}
            Reject
          </Button>
        </div>
      </div>
    </section>
  );
}
