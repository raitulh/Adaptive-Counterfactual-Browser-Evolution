"use client";

/**
 * ApprovalCard — used by the Approval Center and inline in task detail. It restates exactly what
 * will happen (action, tool, target, arguments, risk, permission, reasons), counts down to expiry,
 * links to the task and step, and makes the decision proportionally deliberate:
 * high risk → confirmation dialog, critical → type-to-confirm, reject → a required reason.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRightIcon, CheckIcon, ClockIcon, HandIcon, ShieldAlertIcon, XIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Badge, PermissionBadge, RiskBadge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { InlineError } from "@/components/ui/states";
import { RelativeTime } from "@/components/ui/data-display";
import { tasksApi, type ApprovalOut } from "@/lib/api";
import { dateTime, humanize, humanizeTool } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { permissionLevelMeta, riskLevelMeta } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useNow } from "@/components/tasks/hooks";
import { toolIcon } from "@/components/tasks/timeline/tool-meta";
import { ArgumentsPreview } from "./arguments-preview";
import {
  approvalConfirmationMode,
  decisionBlock,
  rejectReasonError,
  REJECT_REASON_MAX,
  remainingLabel,
  typeToConfirmPhrase,
} from "./decision";
import { useApprovalDecision } from "./use-approval-decision";
import { readable } from "@/components/tasks/timeline/readable";

export interface ApprovalCardProps {
  approval: ApprovalOut;
  /** Show the linked task's goal and step (fetches the task). */
  showTaskLink?: boolean;
  /** Visually highlight (deep link target). */
  highlighted?: boolean;
  /** Compact layout (arguments collapsed by default). */
  compact?: boolean;
  className?: string;
}

function targetLabel(target: string | null): string | null {
  if (!target) return null;
  const [kind, ...rest] = target.split(":");
  return rest.length ? `${humanize(kind)} · ${rest.join(":")}` : target;
}

function ExpiryCountdown({ expiresAt, active }: { expiresAt: string; active: boolean }) {
  const now = useNow(1000, active);
  const r = remainingLabel(expiresAt, now);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs tabular-nums",
        r.expired ? "text-fg-subtle" : r.urgent ? "text-warning" : "text-fg-muted",
      )}
      title={dateTime(expiresAt)}
    >
      <ClockIcon className="size-3" aria-hidden />
      {r.label}
    </span>
  );
}

const rejectSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Tell AgentOS why, so it can adjust the plan.")
    .max(REJECT_REASON_MAX, `Keep the reason under ${REJECT_REASON_MAX} characters.`),
});

function RejectDialog({
  open,
  onOpenChange,
  approval,
  pending,
  error,
  onReject,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  approval: ApprovalOut;
  pending: boolean;
  error: unknown;
  onReject: (reason: string) => void;
}) {
  const form = useForm<z.infer<typeof rejectSchema>>({
    resolver: zodResolver(rejectSchema),
    defaultValues: { reason: "" },
  });
  const reason = useWatch({ control: form.control, name: "reason" }) ?? "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <form
          onSubmit={form.handleSubmit(({ reason: r }) => {
            if (!rejectReasonError(r)) onReject(r.trim());
          })}
          className="flex min-h-0 flex-col"
        >
          <DialogHeader>
            <DialogTitle>Reject this action?</DialogTitle>
            <DialogDescription>
              AgentOS will not run <span className="text-fg">{readable(approval.summary)}</span>. The step fails and the
              task continues only with steps that don&apos;t depend on it.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field
              label="Reason"
              required
              description="Shared with the task history so the outcome is explainable."
              error={form.formState.errors.reason?.message}
            >
              {(ids) => (
                <Textarea
                  {...ids}
                  autoFocus
                  rows={3}
                  maxLength={REJECT_REASON_MAX}
                  placeholder="e.g. Wrong recipient — use the team alias instead"
                  {...form.register("reason")}
                />
              )}
            </Field>
            <p className="mt-1 text-right text-2xs text-fg-subtle tabular-nums">
              {reason.length}/{REJECT_REASON_MAX}
            </p>
            {error ? <InlineError error={error} className="mt-2" /> : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Keep it pending
            </Button>
            <Button type="submit" variant="danger" loading={pending}>
              Reject action
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LinkedTask({ approval }: { approval: ApprovalOut }) {
  const task = useQuery({
    queryKey: qk.tasks.detail(approval.task_id),
    queryFn: ({ signal }) => tasksApi.get(approval.task_id, { signal }),
    staleTime: 60_000,
  });
  const step = task.data?.steps.find((s) => s.id === approval.step_id);
  return (
    <Link
      href={`/app/tasks/${approval.task_id}`}
      className="group flex min-w-0 items-center gap-2 rounded-lg border border-line bg-surface-2/50 px-3 py-2 text-[13px] transition-colors outline-none hover:border-line-strong hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-fg">
          {task.data?.goal ?? (task.isLoading ? "Loading task…" : "Open task")}
        </span>
        {step && (
          <span className="block truncate text-xs text-fg-muted">
            Step {step.position + 1}: {step.action}
          </span>
        )}
      </span>
      <ArrowUpRightIcon className="size-4 shrink-0 text-fg-subtle transition-colors group-hover:text-fg" aria-hidden />
    </Link>
  );
}

export function ApprovalCard({
  approval: initial,
  showTaskLink = false,
  highlighted = false,
  compact = false,
  className,
}: ApprovalCardProps) {
  const { approve, reject, decided } = useApprovalDecision(initial);
  // Only the backend's answer changes what the card shows.
  const approval = decided ?? initial;
  const pending = approval.status === "pending";
  const now = useNow(5_000, pending);
  const block = decisionBlock(approval, now);
  const mode = approvalConfirmationMode(approval.risk_level, approval.permission_level);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [showArgs, setShowArgs] = React.useState(!compact);
  const risk = riskLevelMeta[approval.risk_level];
  const busy = approve.isPending || reject.isPending;

  const doApprove = () =>
    approve.mutate(undefined, {
      onSuccess: () => setConfirmOpen(false),
    });

  return (
    <article
      id={`approval-${approval.id}`}
      className={cn(
        "scroll-mt-24 rounded-xl border bg-surface-1 transition-[box-shadow,border-color] duration-500",
        pending && !block ? "border-warning/30" : "border-line",
        highlighted && "border-warning/70 shadow-[0_0_0_3px_rgb(245_184_74/0.18)]",
        className,
      )}
      aria-label={`Approval: ${readable(approval.summary)}`}
      tabIndex={-1}
    >
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg border",
              pending && !block
                ? "border-warning/35 bg-warning/10 text-warning"
                : "border-line-strong bg-surface-2 text-fg-muted",
            )}
            aria-hidden
          >
            {React.createElement(toolIcon(approval.tool_name), { className: "size-4" })}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge kind="approval" value={approval.status} />
              {pending && <ExpiryCountdown expiresAt={approval.expires_at} active={pending} />}
              {!pending && (
                <RelativeTime
                  value={approval.approved_at ?? approval.rejected_at ?? approval.created_at}
                  className="text-xs text-fg-subtle"
                />
              )}
            </div>
            <h3 className="mt-1.5 text-[15px] leading-snug font-semibold tracking-tight text-fg">
              {readable(approval.summary)}
            </h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
              <span>{humanizeTool(approval.tool_name)}</span>
              <code className="font-mono text-2xs text-fg-subtle">{approval.tool_name}</code>
              {approval.action !== approval.tool_name && <span>· {humanize(approval.action)}</span>}
              {targetLabel(approval.target) && <span>· Target: {targetLabel(approval.target)}</span>}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <RiskBadge level={approval.risk_level} />
          <PermissionBadge level={approval.permission_level} />
          <span className="text-xs text-fg-subtle">
            {risk.description} {permissionLevelMeta[approval.permission_level].description}
          </span>
        </div>

        {approval.reasons.length > 0 && (
          <div>
            <p className="text-2xs font-medium tracking-wider text-fg-subtle uppercase">
              {pending ? "Why this needs you" : "Why it needed approval"}
            </p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {approval.reasons.map((r, i) => (
                <li key={i}>
                  <Badge tone="warning" variant="outline" className="h-auto py-0.5 whitespace-normal">
                    {r.charAt(0).toUpperCase() + r.slice(1)}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <button
            type="button"
            className="text-2xs font-medium tracking-wider text-fg-subtle uppercase outline-none hover:text-fg-muted focus-visible:ring-2 focus-visible:ring-accent/50"
            aria-expanded={showArgs}
            onClick={() => setShowArgs((s) => !s)}
          >
            {pending ? "Exactly what will be sent" : "Exactly what was requested"} {showArgs ? "▾" : "▸"}
          </button>
          {showArgs && <ArgumentsPreview args={approval.arguments_preview} className="mt-2" />}
        </div>

        {showTaskLink && <LinkedTask approval={approval} />}

        {approval.status === "rejected" && approval.rejection_reason && (
          <p className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-[13px] text-fg">
            <span className="text-danger">Rejected:</span> {approval.rejection_reason}
          </p>
        )}
        {approval.status === "approved" && (
          <p className="flex items-center gap-1.5 text-[13px] text-success">
            <CheckIcon className="size-4" aria-hidden />
            Approved{approval.consumed_at ? " — the action has run" : " — AgentOS will run it next"}.
          </p>
        )}
      </div>

      {pending && (
        <div className="flex flex-col gap-2 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:px-5">
          {block === "expired" ? (
            <p className="flex-1 text-[13px] text-fg-muted">
              Expired — AgentOS will not run this action. Resume the task to request a fresh approval.
            </p>
          ) : (
            <p className="flex flex-1 items-center gap-1.5 text-xs text-fg-subtle">
              {mode !== "none" ? (
                <ShieldAlertIcon className="size-3.5 text-warning" aria-hidden />
              ) : (
                <HandIcon className="size-3.5" aria-hidden />
              )}
              {mode === "type"
                ? "Critical: you will be asked to type the tool name."
                : mode === "confirm"
                  ? "You will confirm exactly what runs."
                  : "Runs as shown once approved."}
            </p>
          )}
          {(approve.error || reject.error) && !confirmOpen && !rejectOpen ? (
            <InlineError error={approve.error ?? reject.error} className="sm:max-w-xs" />
          ) : null}
          <div className="flex gap-2 sm:ml-auto">
            <Button
              variant="danger-outline"
              size="sm"
              disabled={Boolean(block) || busy}
              onClick={() => setRejectOpen(true)}
            >
              <XIcon /> Reject
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={Boolean(block)}
              loading={approve.isPending && !confirmOpen}
              onClick={() => (mode === "none" ? doApprove() : setConfirmOpen(true))}
            >
              <CheckIcon /> Approve
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(o) => !approve.isPending && setConfirmOpen(o)}
        title={`Approve: ${readable(approval.summary)}?`}
        description={
          <>
            AgentOS will run <code className="font-mono text-fg">{approval.tool_name}</code> on your behalf, exactly as
            shown below. <span className="text-warning">{risk.label}:</span> {risk.description.toLowerCase()}
          </>
        }
        confirmLabel="Approve and run"
        tone={mode === "type" ? "danger" : "default"}
        confirmText={mode === "type" ? typeToConfirmPhrase(approval) : undefined}
        loading={approve.isPending}
        onConfirm={doApprove}
      >
        <div className="max-h-64 overflow-y-auto rounded-lg border border-line bg-surface-1 p-3">
          <ArgumentsPreview args={approval.arguments_preview} />
        </div>
        {approve.error ? <InlineError error={approve.error} className="mt-3" /> : null}
      </ConfirmDialog>

      <RejectDialog
        open={rejectOpen}
        onOpenChange={(o) => !reject.isPending && setRejectOpen(o)}
        approval={approval}
        pending={reject.isPending}
        error={reject.error}
        onReject={(reason) => reject.mutate(reason, { onSuccess: () => setRejectOpen(false) })}
      />
    </article>
  );
}
