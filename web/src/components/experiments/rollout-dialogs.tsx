"use client";

import { RadioTowerIcon, UndoDotIcon } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
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
import { Input, Textarea } from "@/components/ui/input";
import { normalizeError } from "@/lib/api";
import { durationMs } from "@/lib/format";
import { cn } from "@/lib/utils";
import { InlineAlert } from "@/components/settings/inline-alert";

/**
 * Human-readable explanation for rollout refusals (canary period, traffic, failure-rate gate). The
 * backend puts the facts in `details`; we only phrase them.
 */
export function rolloutErrorMessage(error: unknown): string {
  const e = normalizeError(error);
  const d = e.details ?? {};
  if (e.code === "canary_period_active" && typeof d.remaining_seconds === "number") {
    return `The canary observation period is still running — ${durationMs(d.remaining_seconds * 1000)} left before promotion is allowed.`;
  }
  if (e.code === "canary_insufficient_traffic" && typeof d.canary_tasks === "number") {
    return `Not enough canary traffic yet (${d.canary_tasks} tasks on the canary). Let it serve more tasks before promoting.`;
  }
  if (
    e.code === "canary_failure_rate_increased" &&
    typeof d.canary_failure_rate === "number" &&
    typeof d.baseline_failure_rate === "number"
  ) {
    return `The canary's failure rate for this pattern (${(d.canary_failure_rate * 100).toFixed(1)}%) is above the baseline (${(d.baseline_failure_rate * 100).toFixed(1)}%). Roll it back instead.`;
  }
  if (e.code === "experiment_runs_pending" && Array.isArray(d.variants)) {
    return `Evaluation runs haven't finished for: ${(d.variants as string[]).join(", ")}.`;
  }
  return e.userMessage;
}

const PRESETS = [1, 5, 10, 25, 50];

export function CanaryDialog({
  open,
  onOpenChange,
  title,
  subject,
  current,
  loading,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subject: React.ReactNode;
  current?: number;
  loading: boolean;
  error: unknown;
  onSubmit: (percentage: number) => void;
}) {
  const [value, setValue] = React.useState<number>(current && current > 0 && current < 100 ? current : 10);
  const valid = Number.isInteger(value) && value >= 1 && value <= 99;
  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent size="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onSubmit(value);
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RadioTowerIcon className="size-4 text-accent" aria-hidden /> {title}
            </DialogTitle>
            <DialogDescription>
              {subject} A fixed share of real tasks — chosen deterministically per task — will use the new strategy
              while it is observed. You can adjust the share or roll it back at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <Field
              label="Share of tasks on the canary"
              description="The server enforces the platform's maximum canary share and rejects larger values."
            >
              {(ids) => (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Input
                      {...ids}
                      type="number"
                      min={1}
                      max={99}
                      value={Number.isFinite(value) ? value : ""}
                      onChange={(e) => setValue(e.target.valueAsNumber)}
                      className="w-24 pr-7 font-mono"
                      aria-invalid={!valid || undefined}
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-fg-subtle">
                      %
                    </span>
                  </div>
                  <div className="flex gap-1" role="group" aria-label="Presets">
                    {PRESETS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setValue(p)}
                        className={cn(
                          "h-8 rounded-md border px-2.5 font-mono text-xs transition-colors",
                          value === p
                            ? "border-accent/50 bg-accent/10 text-accent"
                            : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                        )}
                        aria-pressed={value === p}
                      >
                        {p}%
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Field>
            <div className="h-2 overflow-hidden rounded-full bg-accent/10" aria-hidden>
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${valid ? value : 0}%` }}
              />
            </div>
            {error ? <InlineAlert message={rolloutErrorMessage(error)} error={error} /> : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={loading} disabled={!valid}>
              Start canary at {valid ? value : "—"}%
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RollbackDialog({
  open,
  onOpenChange,
  title,
  description,
  loading,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  loading: boolean;
  error: unknown;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  const trimmed = reason.trim();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (loading) return;
        if (!o) setReason("");
        onOpenChange(o);
      }}
    >
      <DialogContent size="md" className="border-danger/35">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed) onSubmit(trimmed);
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-danger">
              <UndoDotIcon className="size-4" aria-hidden /> {title}
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label="Reason" required description="Recorded in the audit log and shown on this page.">
              {(ids) => (
                <Textarea
                  {...ids}
                  autoFocus
                  rows={3}
                  maxLength={2000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Canary raised calendar verification failures"
                />
              )}
            </Field>
            {error ? <InlineAlert className="mt-3" message={rolloutErrorMessage(error)} error={error} /> : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={loading} disabled={!trimmed}>
              Roll back now
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
