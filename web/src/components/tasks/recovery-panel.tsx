"use client";

/**
 * Recovery & failure explanations for recovering / requires_reconciliation / blocked / expired /
 * failed tasks: what happened, the evidence (Expected / Observed / Difference), what AgentOS
 * already tried, and the concrete next actions — never just "Something went wrong".
 */
import {
  AlertOctagonIcon,
  ArrowUpRightIcon,
  CheckIcon,
  CircleHelpIcon,
  LifeBuoyIcon,
  PlugIcon,
  PlayIcon,
  RotateCcwIcon,
  TimerOffIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import type { StepOut, TaskDetailView, VerificationOut } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { InlineError } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { humanize, humanizeTool } from "@/lib/format";
import { taskControls, toneClasses, type Tone } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { TaskActions } from "./hooks";
import { errorLabel, verificationMethodLabel, type TimelineEntry } from "./timeline/normalize";
import { readable } from "./timeline/readable";

const CONNECTION_CODES = new Set([
  "integration_not_connected",
  "integration_expired",
  "integration_revoked",
  "insufficient_scope",
]);

export function isConnectionBlock(task: Pick<TaskDetailView, "failure_code" | "steps" | "plan_version">): boolean {
  if (task.failure_code && CONNECTION_CODES.has(task.failure_code)) return true;
  return task.steps.some(
    (s) =>
      s.plan_version === task.plan_version &&
      (s.status === "blocked" || s.status === "failed") &&
      (s.error_class === "auth_expired" ||
        (s.error_class === "permission_denied" && /connect|scope|grant/i.test(s.error_message ?? ""))),
  );
}

function Shell({
  tone,
  icon: Icon,
  title,
  children,
  id,
}: {
  tone: Tone;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
  id?: string;
}) {
  const t = toneClasses[tone];
  return (
    <section
      id={id}
      aria-labelledby={`${id ?? "recovery"}-title`}
      className={cn("scroll-mt-24 rounded-xl border bg-surface-1 p-4 sm:p-5", t.border)}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg border", t.border, t.soft, t.text)}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
        <h2
          id={`${id ?? "recovery"}-title`}
          className="pt-1.5 text-[15px] leading-snug font-semibold tracking-tight text-fg"
        >
          {title}
        </h2>
      </div>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-2xs font-semibold tracking-[0.12em] text-fg-subtle uppercase">{children}</h3>;
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(show).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Expected / Observed / Difference, field by field. */
export function VerificationComparison({
  verification,
}: {
  verification: Pick<VerificationOut, "expected" | "observed" | "differences" | "method" | "status" | "evidence">;
}) {
  const diffFields = new Set(
    verification.differences.map((d) => (typeof d?.field === "string" ? d.field : "")).filter(Boolean),
  );
  const fields = [
    ...new Set([
      ...Object.keys(verification.expected ?? {}),
      ...Object.keys(verification.observed ?? {}),
      ...diffFields,
    ]),
  ];
  const link =
    typeof verification.evidence?.html_link === "string" && /^https?:\/\//.test(verification.evidence.html_link)
      ? verification.evidence.html_link
      : null;
  if (fields.length === 0) {
    return (
      <p className="text-[13px] text-fg-muted">
        The provider returned no details to compare ({verificationMethodLabel(verification.method)?.toLowerCase()}).
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[28rem] text-left text-[13px]">
        <caption className="sr-only">Expected versus observed values</caption>
        <thead>
          <tr className="border-b border-line bg-surface-2/60 text-2xs tracking-wider text-fg-subtle uppercase">
            <th scope="col" className="px-3 py-2 font-medium">
              Field
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Expected
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Observed
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Difference
            </th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => {
            const diff = verification.differences.find((d) => d?.field === f);
            const expected = diff && "expected" in diff ? diff.expected : verification.expected?.[f];
            const observed = diff && "observed" in diff ? diff.observed : verification.observed?.[f];
            const differs = diffFields.has(f);
            return (
              <tr
                key={f}
                className={cn("border-b border-line align-top last:border-0", differs && "bg-recover/[0.06]")}
              >
                <th scope="row" className="px-3 py-2 font-normal text-fg-muted">
                  {humanize(f)}
                </th>
                <td className="max-w-56 px-3 py-2 break-words text-fg">{show(expected)}</td>
                <td className="max-w-56 px-3 py-2 break-words text-fg">{show(observed)}</td>
                <td className={cn("px-3 py-2", differs ? "text-recover" : "text-fg-subtle")}>
                  {differs ? "Differs" : "Matches"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 border-t border-line px-3 py-2 text-xs text-accent hover:underline"
        >
          Open in the provider <ArrowUpRightIcon className="size-3" aria-hidden />
        </a>
      )}
    </div>
  );
}

function latestVerification(verifications: VerificationOut[], stepId: string): VerificationOut | null {
  const list = verifications.filter((v) => v.step_id === stepId);
  return list.length ? list[list.length - 1] : null;
}

function ReconcileStep({
  step,
  verification,
  actions,
}: {
  step: StepOut;
  verification: VerificationOut | null;
  actions: TaskActions;
}) {
  const [choice, setChoice] = React.useState<"succeeded" | "did_not_happen" | null>(null);
  const [note, setNote] = React.useState("");
  const m = actions.confirmStep;
  const confirm = () =>
    new Promise<void>((resolve) => {
      m.mutate(
        { stepId: step.id, body: { outcome: choice!, note: note.trim() || null } },
        {
          onSuccess: () => {
            toast.success(
              choice === "succeeded"
                ? "Thanks — marked as done. AgentOS continues."
                : "Thanks — AgentOS will run this step again.",
            );
            setChoice(null);
            setNote("");
            resolve();
          },
          onError: () => resolve(),
        },
      );
    });
  return (
    <div className="rounded-lg border border-recover/30 bg-recover/[0.04] p-3.5">
      <p className="text-sm font-medium text-fg">{step.action}</p>
      <p className="mt-0.5 text-xs text-fg-muted">
        {humanizeTool(step.tool_name)} · <code className="font-mono text-2xs">{step.tool_name}</code>
        {step.output_summary && <> · {readable(step.output_summary)}</>}
      </p>
      {step.error_message && <p className="mt-2 text-[13px] leading-relaxed text-fg">{readable(step.error_message)}</p>}
      <div className="mt-3">
        {verification ? (
          <VerificationComparison verification={verification} />
        ) : (
          <p className="text-[13px] text-fg-muted">
            No read-back evidence was recorded for this action, so AgentOS can&apos;t tell whether it took effect.
          </p>
        )}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setChoice("succeeded")}
          className="rounded-lg border border-line-strong bg-surface-1 p-3 text-left transition-colors outline-none hover:border-success/40 hover:bg-success/5 focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
            <CheckIcon className="size-4 text-success" aria-hidden /> It happened
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-fg-muted">
            You checked and the result is there. The step is marked done (confirmed by you) and is never repeated.
          </span>
        </button>
        <button
          type="button"
          onClick={() => setChoice("did_not_happen")}
          className="rounded-lg border border-line-strong bg-surface-1 p-3 text-left transition-colors outline-none hover:border-recover/40 hover:bg-recover/5 focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
            <RotateCcwIcon className="size-4 text-recover" aria-hidden /> It did not happen
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-fg-muted">
            You checked and it&apos;s not there. AgentOS runs the step again — only choose this if you are sure, or it
            may happen twice.
          </span>
        </button>
      </div>
      {m.error && !choice ? <InlineError error={m.error} className="mt-2" /> : null}
      <ConfirmDialog
        open={choice !== null}
        onOpenChange={(o) => !m.isPending && !o && setChoice(null)}
        title={choice === "succeeded" ? "Confirm it happened?" : "Confirm it did not happen?"}
        description={
          choice === "succeeded"
            ? `“${step.action}” will be recorded as completed and confirmed by you. AgentOS continues with the next steps and will not repeat it.`
            : `AgentOS will run “${step.action}” again. If it actually did happen, it will happen twice.`
        }
        confirmLabel={choice === "succeeded" ? "Yes, it happened" : "Run it again"}
        tone={choice === "did_not_happen" ? "danger" : "default"}
        loading={m.isPending}
        onConfirm={confirm}
      >
        <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
          Note for the audit trail (optional)
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            placeholder="e.g. Checked the calendar — event is there"
          />
        </label>
        {m.error ? <InlineError error={m.error} className="mt-2" /> : null}
      </ConfirmDialog>
    </div>
  );
}

function Tried({ entries, stepIds }: { entries: readonly TimelineEntry[]; stepIds: Set<string> }) {
  const relevant = entries.filter(
    (e) =>
      e.stepId && stepIds.has(e.stepId) && (e.kind === "recovery" || (e.kind === "tool_call" && e.state === "failed")),
  );
  if (relevant.length === 0) return null;
  const calls = relevant.filter((e) => e.kind === "tool_call");
  const retries = relevant.filter((e) => e.kind === "recovery" && e.title.startsWith("Retrying"));
  return (
    <div>
      <SubHeading>What AgentOS tried</SubHeading>
      <ul className="mt-1.5 flex flex-col gap-1 text-[13px] text-fg">
        {calls.length > 0 && (
          <li className="flex gap-2">
            <XIcon className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
            {calls.length} failed attempt{calls.length === 1 ? "" : "s"}:{" "}
            {[...new Set(calls.map((c) => c.detail).filter(Boolean))].join("; ")}
          </li>
        )}
        {retries.length > 0 && (
          <li className="flex gap-2">
            <RotateCcwIcon className="mt-0.5 size-3.5 shrink-0 text-recover" aria-hidden />
            Retried automatically {retries.length} time{retries.length === 1 ? "" : "s"} with backoff
          </li>
        )}
        {relevant
          .filter((e) => e.kind === "recovery" && !e.title.startsWith("Retrying"))
          .map((e) => (
            <li key={e.key} className="flex gap-2">
              <LifeBuoyIcon className="mt-0.5 size-3.5 shrink-0 text-recover" aria-hidden />
              <span>
                {e.title}
                {e.detail && <span className="text-fg-muted"> — {e.detail}</span>}
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}

export interface RecoveryPanelProps {
  task: TaskDetailView;
  actions: TaskActions;
  entries: readonly TimelineEntry[];
  /** Optional: jump to the input form (for failures that need information). */
  onProvideInput?: () => void;
}

export function RecoveryPanel({ task, actions, entries }: RecoveryPanelProps) {
  const current = task.steps.filter((s) => s.plan_version === task.plan_version);
  const controls = taskControls(task.status, task.plan_version);
  const resume = (label = "Resume") =>
    controls.resume ? (
      <Button
        variant="primary"
        size="sm"
        loading={actions.resume.isPending}
        onClick={() => actions.resume.mutate(undefined, { onSuccess: () => toast.success("Resumed.") })}
      >
        <PlayIcon /> {label}
      </Button>
    ) : null;
  const resumeError = actions.resume.error ? <InlineError error={actions.resume.error} /> : null;

  if (task.status === "requires_reconciliation") {
    const steps = current.filter((s) => s.status === "requires_reconciliation");
    return (
      <Shell
        id="confirm-outcome"
        tone="recover"
        icon={CircleHelpIcon}
        title="AgentOS could not fully verify the external result"
      >
        <p className="text-[13px] leading-relaxed text-fg-muted">
          An action may or may not have taken effect. To make sure nothing happens twice, AgentOS stopped and needs you
          to check the external system and tell it what you see.
        </p>
        {steps.map((s) => (
          <ReconcileStep
            key={s.id}
            step={s}
            verification={latestVerification(task.verifications, s.id)}
            actions={actions}
          />
        ))}
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <p className="mr-auto text-xs text-fg-subtle">
            Not sure? Let AgentOS try its automatic check again, or cancel the task.
          </p>
          {controls.resume && (
            <Button
              variant="secondary"
              size="sm"
              loading={actions.resume.isPending}
              onClick={() => actions.resume.mutate(undefined, { onSuccess: () => toast.success("Checking again.") })}
            >
              <RotateCcwIcon /> Check automatically again
            </Button>
          )}
        </div>
        {resumeError}
      </Shell>
    );
  }

  if (task.status === "blocked") {
    const blocked = current.filter((s) => s.status === "blocked" || s.status === "failed");
    const connection = isConnectionBlock(task);
    const policy = task.failure_code === "policy_denied" || blocked.some((s) => s.error_class === "policy_blocked");
    return (
      <Shell
        tone="danger"
        icon={connection ? PlugIcon : AlertOctagonIcon}
        title={
          connection ? "Blocked — Google needs to be connected" : "Blocked — AgentOS needs you to fix something first"
        }
      >
        <p className="text-[13px] leading-relaxed text-fg-muted">
          {connection
            ? "A step needs access to an account that isn't connected (or whose access expired). Nothing was changed. Connect it, then resume — AgentOS continues from the blocked step."
            : policy
              ? "Your organization's policy does not allow an action this task needs. Resuming won't change that — adjust the goal or ask an admin."
              : (task.failure_message ?? "A step can't continue without your help.")}
        </p>
        {blocked.length > 0 && (
          <ul className="flex flex-col gap-2">
            {blocked.map((s) => (
              <li key={s.id} className="rounded-lg border border-line bg-surface-2/50 px-3 py-2 text-[13px]">
                <p className="font-medium text-fg">{s.action}</p>
                <p className="mt-0.5 text-fg-muted">
                  {errorLabel(s.error_class)}
                  {s.error_message && ` — ${s.error_message}`}
                </p>
              </li>
            ))}
          </ul>
        )}
        {task.failure_code && !blocked.length && (
          <p className="font-mono text-2xs text-fg-subtle">{task.failure_code}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {connection && (
            <Button asChild variant="primary" size="sm">
              <Link href="/app/integrations">
                <PlugIcon /> Connect Google
              </Link>
            </Button>
          )}
          {!policy &&
            (controls.resume ? (
              <Button
                variant={connection ? "secondary" : "primary"}
                size="sm"
                loading={actions.resume.isPending}
                onClick={() => actions.resume.mutate(undefined, { onSuccess: () => toast.success("Resumed.") })}
              >
                <PlayIcon /> {connection ? "I've connected it — resume" : "Resume"}
              </Button>
            ) : null)}
        </div>
        {resumeError}
      </Shell>
    );
  }

  if (task.status === "expired") {
    return (
      <Shell tone="neutral" icon={TimerOffIcon} title="Expired while waiting">
        <p className="text-[13px] leading-relaxed text-fg-muted">
          The task waited longer than allowed (for an approval or its time limit). Nothing further ran. Resume to
          continue — any action that needs approval will ask again.
        </p>
        <div className="flex gap-2">{resume("Resume")}</div>
        {resumeError}
      </Shell>
    );
  }

  if (task.status === "recovering") {
    const recent = entries.filter((e) => e.phase === "recovery").slice(-3);
    return (
      <Shell tone="recover" icon={LifeBuoyIcon} title="AgentOS is recovering from a problem">
        <p className="text-[13px] leading-relaxed text-fg-muted">
          It is deciding the safest next step automatically. You don&apos;t need to do anything unless it asks.
        </p>
        {recent.length > 0 && (
          <ul className="flex flex-col gap-1 text-[13px] text-fg">
            {recent.map((e) => (
              <li key={e.key}>
                {e.title}
                {e.detail && <span className="text-fg-muted"> — {e.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </Shell>
    );
  }

  if (task.status === "failed") {
    const failedSteps = current.filter((s) => s.status === "failed");
    const planFailure =
      task.plan_version === 0 || task.failure_code === "plan_invalid" || task.failure_code === "policy_denied";
    const connection = isConnectionBlock(task);
    return (
      <Shell tone="danger" icon={AlertOctagonIcon} title="The task did not complete">
        <div>
          <SubHeading>What failed</SubHeading>
          <p className="mt-1 text-[13px] leading-relaxed text-fg">
            {task.failure_message ??
              (planFailure
                ? "AgentOS could not produce a valid plan for this goal."
                : "A step could not be completed.")}
          </p>
          {task.failure_code && <p className="mt-0.5 font-mono text-2xs text-fg-subtle">{task.failure_code}</p>}
        </div>
        {failedSteps.length > 0 && (
          <div>
            <SubHeading>Which step and why</SubHeading>
            <ul className="mt-1.5 flex flex-col gap-2">
              {failedSteps.map((s) => (
                <li key={s.id} className="rounded-lg border border-danger/25 bg-danger/[0.04] px-3 py-2 text-[13px]">
                  <p className="font-medium text-fg">
                    Step {s.position + 1}: {s.action}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {humanizeTool(s.tool_name)} · <code className="font-mono text-2xs">{s.tool_name}</code> ·{" "}
                    {s.attempt_count} attempt{s.attempt_count === 1 ? "" : "s"}
                  </p>
                  <p className="mt-1 text-fg">
                    {errorLabel(s.error_class)}
                    {s.error_message && <span className="text-fg-muted"> — {s.error_message}</span>}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Tried entries={entries} stepIds={new Set(failedSteps.map((s) => s.id))} />
        <div>
          <SubHeading>What you can do</SubHeading>
          <ul className="mt-1.5 flex flex-col gap-1 text-[13px] text-fg-muted">
            {controls.resume && (
              <li>
                <span className="text-fg">Resume</span> —{" "}
                {planFailure
                  ? "AgentOS plans again from scratch."
                  : "failed steps run again; completed and verified steps are kept and never repeated."}
              </li>
            )}
            {connection && (
              <li>
                <Link href="/app/integrations" className="text-accent hover:underline">
                  Connect Google
                </Link>{" "}
                first — the failure came from a missing or expired connection.
              </li>
            )}
            <li>
              <span className="text-fg">Cancel</span> — stop here; anything already done stays as it is.
            </li>
          </ul>
        </div>
        <div className="flex flex-wrap gap-2">{resume(planFailure ? "Plan again" : "Resume")}</div>
        {resumeError}
      </Shell>
    );
  }
  return null;
}
