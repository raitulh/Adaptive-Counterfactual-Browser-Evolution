"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDownIcon, GaugeIcon, WorkflowIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  InlineError,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  toast,
} from "@/components/ui";
import { newIdempotencyKey, type AutomationCreate, type AutomationOut, type AutomationUpdate } from "@/lib/api";
import { isApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { readPolicy, readRetryPolicy, readTemplate } from "./automation-status";
import { useAgentOptions, useCreateAutomation, useUpdateAutomation } from "./hooks";
import { browserTimeZone, isValidTimeZone, normalizeCron, validateCron } from "./schedule";
import { ScheduleEditor } from "./schedule-editor";
import { RunTimeline, ScheduleSentence } from "./schedule-preview";
import { TimezonePicker } from "./timezone-picker";

const intIn = (min: number, max: number, label: string, optional = false) =>
  z
    .string()
    .trim()
    .refine((v) => (optional && v === "") || (/^\d+$/.test(v) && Number(v) >= min && Number(v) <= max), {
      message: `${label} must be a whole number from ${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")}.`,
    });

// Mirrors backend AutomationCreate / TaskTemplate / RetryPolicy / AutomationPolicy constraints.
const schema = z.object({
  name: z.string().trim().min(1, "Give it a name.").max(200, "Keep the name under 200 characters."),
  cron: z.string().superRefine((v, ctx) => {
    const r = validateCron(v);
    if (!r.ok) ctx.addIssue({ code: "custom", message: r.error });
  }),
  timezone: z.string().refine(isValidTimeZone, "Choose a valid time zone."),
  goal: z
    .string()
    .trim()
    .min(1, "Describe what each run should do.")
    .max(4000, "Keep the goal under 4,000 characters."),
  context: z.string().max(8000, "Keep the context under 8,000 characters."),
  agent_id: z.string(),
  priority: intIn(0, 1000, "Priority"),
  max_duration_minutes: intIn(1, 10080, "Time limit", true),
  enabled: z.boolean(),
  max_runs: intIn(1, 1_000_000, "Max runs", true),
  retry_max_attempts: intIn(1, 5, "Attempts"),
  retry_backoff_seconds: intIn(10, 3600, "Backoff"),
  pause_on_failure: z.boolean(),
  max_consecutive_failures: intIn(1, 100, "Failure threshold"),
});
type Values = z.infer<typeof schema>;

export interface BuilderDraft {
  name?: string;
  goal?: string;
  cron?: string;
}

const FIELD_MAP: Record<string, keyof Values> = {
  name: "name",
  cron_expression: "cron",
  timezone: "timezone",
  "task_template.goal": "goal",
  "task_template.context": "context",
  "task_template.agent_id": "agent_id",
  "task_template.priority": "priority",
  "task_template.max_duration_seconds": "max_duration_minutes",
  max_runs: "max_runs",
  "retry_policy.max_attempts": "retry_max_attempts",
  "retry_policy.backoff_seconds": "retry_backoff_seconds",
  "policy.max_consecutive_failures": "max_consecutive_failures",
};

function defaults(automation: AutomationOut | null | undefined, draft: BuilderDraft | undefined): Values {
  if (automation) {
    const t = readTemplate(automation.task_template);
    const r = readRetryPolicy(automation.retry_policy);
    const p = readPolicy(automation.policy);
    return {
      name: automation.name,
      cron: automation.cron_expression,
      timezone: automation.timezone,
      goal: t.goal,
      context: t.context ?? "",
      agent_id: t.agent_id ?? "",
      priority: String(t.priority),
      max_duration_minutes: t.max_duration_seconds ? String(Math.max(1, Math.round(t.max_duration_seconds / 60))) : "",
      enabled: automation.enabled,
      max_runs: automation.max_runs ? String(automation.max_runs) : "",
      retry_max_attempts: String(r.max_attempts),
      retry_backoff_seconds: String(r.backoff_seconds),
      pause_on_failure: p.pause_on_failure,
      max_consecutive_failures: String(p.max_consecutive_failures),
    };
  }
  return {
    name: draft?.name ?? "",
    cron: draft?.cron ?? "0 8 * * 1-5",
    timezone: browserTimeZone(),
    goal: draft?.goal ?? "",
    context: "",
    agent_id: "",
    priority: "100",
    max_duration_minutes: "",
    enabled: true,
    max_runs: "",
    retry_max_attempts: "3",
    retry_backoff_seconds: "60",
    pause_on_failure: true,
    max_consecutive_failures: "3",
  };
}

export function AutomationBuilderDialog({
  open,
  onOpenChange,
  automation,
  draft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this automation; omit to create a new one. */
  automation?: AutomationOut | null;
  /** Prefill for a new automation (templates). */
  draft?: BuilderDraft;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="max-w-5xl">
        {open && <BuilderForm automation={automation ?? null} draft={draft} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function BuilderForm({
  automation,
  draft,
  onDone,
}: {
  automation: AutomationOut | null;
  draft?: BuilderDraft;
  onDone: () => void;
}) {
  const router = useRouter();
  const create = useCreateAutomation();
  const update = useUpdateAutomation();
  const agents = useAgentOptions(true);
  const [error, setError] = React.useState<unknown>(null);
  const [advanced, setAdvanced] = React.useState(false);
  const attempt = React.useRef<{ body: string; key: string } | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: defaults(automation, draft),
    mode: "onTouched",
  });
  const [cron, timezone, goal, agentId, enabled, pauseOnFailure] = useWatch({
    control: form.control,
    name: ["cron", "timezone", "goal", "agent_id", "enabled", "pause_on_failure"],
  });
  const agentName = agents.data?.items.find((a) => a.id === agentId)?.name ?? null;
  const editing = automation !== null;

  async function submit(v: Values) {
    setError(null);
    const task_template = {
      goal: v.goal.trim(),
      context: v.context.trim() || null,
      agent_id: v.agent_id || null,
      priority: Number(v.priority),
      max_duration_seconds: v.max_duration_minutes ? Number(v.max_duration_minutes) * 60 : null,
    };
    const common = {
      name: v.name.trim(),
      cron_expression: normalizeCron(v.cron),
      timezone: v.timezone,
      task_template,
      enabled: v.enabled,
      max_runs: v.max_runs ? Number(v.max_runs) : null,
      retry_policy: { max_attempts: Number(v.retry_max_attempts), backoff_seconds: Number(v.retry_backoff_seconds) },
      policy: { pause_on_failure: v.pause_on_failure, max_consecutive_failures: Number(v.max_consecutive_failures) },
    };
    try {
      if (automation) {
        const body: AutomationUpdate = { ...common, expected_version: automation.version };
        const saved = await update.mutateAsync({ id: automation.id, body });
        toast.success("Automation saved", { description: saved.name });
        onDone();
      } else {
        const body: AutomationCreate = { ...common, trigger_type: "schedule" };
        const serialized = JSON.stringify(body);
        if (!attempt.current || attempt.current.body !== serialized)
          attempt.current = { body: serialized, key: newIdempotencyKey() };
        const saved = await create.mutateAsync({ body, idempotencyKey: attempt.current.key });
        toast.success("Automation created", {
          description: saved.enabled
            ? "It will run on its schedule. Try “Run now” to see it work."
            : "Saved as paused.",
        });
        onDone();
        router.push(`/app/automations/${saved.id}`);
      }
    } catch (err) {
      if (isApiError(err) && err.kind === "validation") {
        let first = true;
        for (const [field, message] of Object.entries(err.fieldErrors)) {
          const target = FIELD_MAP[field];
          if (!target) continue;
          form.setError(target, { message }, { shouldFocus: first });
          first = false;
        }
      }
      setError(err);
    }
  }

  const { errors, isSubmitting } = form.formState;
  const quota = isApiError(error) && (error.code === "automation_limit_reached" || error.code === "quota_exceeded");
  const conflict = isApiError(error) && error.code === "version_conflict";

  return (
    <form onSubmit={(e) => void form.handleSubmit(submit)(e)} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <div className="mb-1 flex size-9 items-center justify-center rounded-lg border border-line-strong bg-surface-3 text-accent">
          <WorkflowIcon className="size-4.5" aria-hidden />
        </div>
        <DialogTitle>{editing ? "Edit automation" : "New automation"}</DialogTitle>
        <DialogDescription>
          On each scheduled time, AgentOS creates a task from this template — with the same approvals, verification and
          recovery as any task you start yourself.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-7">
          <FormSection title="What should run?">
            <Field label="Name" required error={errors.name?.message}>
              {(ids) => (
                <Input {...ids} {...form.register("name")} placeholder="Morning inbox digest" autoFocus={!editing} />
              )}
            </Field>
            <Field
              label="Goal"
              required
              description="Written like a task you'd give AgentOS. It runs exactly as written each time."
              error={errors.goal?.message}
            >
              {(ids) => (
                <Textarea
                  {...ids}
                  {...form.register("goal")}
                  rows={3}
                  placeholder="Summarize my unread emails from the last 24 hours and list anything that needs a reply."
                />
              )}
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Context" description="Optional background for every run." error={errors.context?.message}>
                {(ids) => (
                  <Textarea
                    {...ids}
                    {...form.register("context")}
                    rows={2}
                    placeholder="Only include threads from customers."
                  />
                )}
              </Field>
              <Field
                label="Agent"
                description="Which agent plans and executes each run."
                error={errors.agent_id?.message}
              >
                {(ids) => (
                  <Controller
                    control={form.control}
                    name="agent_id"
                    render={({ field }) => (
                      <Select
                        value={field.value || "default"}
                        onValueChange={(v) => field.onChange(v === "default" ? "" : v)}
                      >
                        <SelectTrigger {...ids}>
                          <SelectValue placeholder="Default agent" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">Default agent</SelectItem>
                          {(agents.data?.items ?? []).map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name}
                            </SelectItem>
                          ))}
                          {field.value && !agents.data?.items.some((a) => a.id === field.value) && (
                            <SelectItem value={field.value}>Current agent</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    )}
                  />
                )}
              </Field>
            </div>
          </FormSection>

          <FormSection title="When?">
            {/* The editor renders the cron error itself (next to the cron input when editing raw cron). */}
            <Field label="Schedule">
              {(ids) => (
                <ScheduleEditor
                  id={ids.id}
                  initialCron={form.getValues("cron")}
                  onChange={(c) => form.setValue("cron", c, { shouldValidate: true, shouldDirty: true })}
                  error={errors.cron?.message}
                  describedBy={ids["aria-describedby"]}
                />
              )}
            </Field>
            <Field
              label="Time zone"
              description="The schedule follows this zone's local time, including daylight saving."
              error={errors.timezone?.message}
            >
              {(ids) => (
                <Controller
                  control={form.control}
                  name="timezone"
                  render={({ field }) => (
                    <TimezonePicker
                      id={ids.id}
                      value={field.value}
                      onChange={field.onChange}
                      invalid={ids["aria-invalid"]}
                      describedBy={ids["aria-describedby"]}
                    />
                  )}
                />
              )}
            </Field>
          </FormSection>

          <div className="flex items-start justify-between gap-4 rounded-xl border border-line bg-surface-1/60 p-4">
            <div>
              <label htmlFor="automation-enabled" className="text-[13px] font-medium text-fg">
                {editing ? "Enabled" : "Start enabled"}
              </label>
              <p className="mt-0.5 text-xs text-fg-subtle">
                Turned off, it keeps its settings but never runs on schedule.
              </p>
            </div>
            <Controller
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <Switch id="automation-enabled" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>

          <div>
            <button
              type="button"
              onClick={() => setAdvanced((v) => !v)}
              aria-expanded={advanced}
              aria-controls="automation-advanced"
              className="flex w-full items-center justify-between rounded-lg py-1 text-left text-sm font-semibold tracking-tight text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              Limits, retries and failure handling
              <ChevronDownIcon
                className={cn("size-4 text-fg-subtle transition-transform", advanced && "rotate-180")}
                aria-hidden
              />
            </button>
            <div id="automation-advanced" hidden={!advanced} className="mt-4 flex flex-col gap-6">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="Max runs"
                  description="Stop after this many scheduled runs (manual runs don't count). Empty = no limit."
                  error={errors.max_runs?.message}
                >
                  {(ids) => (
                    <Input {...ids} {...form.register("max_runs")} inputMode="numeric" placeholder="No limit" />
                  )}
                </Field>
                <Field
                  label="Time limit per run (minutes)"
                  description="Optional cap on each task's duration."
                  error={errors.max_duration_minutes?.message}
                >
                  {(ids) => (
                    <Input
                      {...ids}
                      {...form.register("max_duration_minutes")}
                      inputMode="numeric"
                      placeholder="Default"
                    />
                  )}
                </Field>
              </div>
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-1 text-[13px] font-medium text-fg">Retry policy</legend>
                <p className="-mt-1 text-xs leading-relaxed text-fg-subtle">
                  Retries apply to <em>starting</em> a run (for example when you&apos;re at your active-task limit). A
                  task that already started is never re-run automatically, because its actions may have side effects.
                </p>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Attempts" description="1–5" error={errors.retry_max_attempts?.message}>
                    {(ids) => <Input {...ids} {...form.register("retry_max_attempts")} inputMode="numeric" />}
                  </Field>
                  <Field
                    label="Backoff (seconds)"
                    description="10–3600, doubles each attempt"
                    error={errors.retry_backoff_seconds?.message}
                  >
                    {(ids) => <Input {...ids} {...form.register("retry_backoff_seconds")} inputMode="numeric" />}
                  </Field>
                </div>
              </fieldset>
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-1 text-[13px] font-medium text-fg">Failure policy</legend>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <label htmlFor="automation-pause" className="text-[13px] text-fg">
                      Pause after repeated failures
                    </label>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      You&apos;re notified either way; pausing stops a broken automation from piling up failed tasks.
                    </p>
                  </div>
                  <Controller
                    control={form.control}
                    name="pause_on_failure"
                    render={({ field }) => (
                      <Switch id="automation-pause" checked={field.value} onCheckedChange={field.onChange} />
                    )}
                  />
                </div>
                <Field
                  label="Consecutive failures before pausing"
                  description="1–100"
                  error={errors.max_consecutive_failures?.message}
                  className={cn(!pauseOnFailure && "opacity-50")}
                >
                  {(ids) => (
                    <Input
                      {...ids}
                      {...form.register("max_consecutive_failures")}
                      inputMode="numeric"
                      disabled={!pauseOnFailure}
                      className="sm:w-40"
                    />
                  )}
                </Field>
              </fieldset>
              <Field
                label="Priority"
                description="0–1000; higher runs first when workers are busy. Default 100."
                error={errors.priority?.message}
              >
                {(ids) => <Input {...ids} {...form.register("priority")} inputMode="numeric" className="sm:w-40" />}
              </Field>
            </div>
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-0 lg:self-start" aria-label="Preview">
          <div className="rounded-xl border border-line bg-surface-1 p-4">
            <h3 className="mb-3 text-2xs font-medium tracking-wider text-fg-subtle uppercase">What happens</h3>
            <ScheduleSentence cron={cron} timezone={timezone} goal={goal} agentName={agentName} />
          </div>
          <div className="rounded-xl border border-line bg-surface-1 p-4">
            <h3 className="mb-3 text-2xs font-medium tracking-wider text-fg-subtle uppercase">Next 7 runs</h3>
            <RunTimeline cron={cron} timezone={timezone} paused={!enabled} />
          </div>
        </aside>
      </DialogBody>
      {error !== null && (
        <div className="flex flex-col gap-2 border-t border-line px-6 pt-4" role="alert">
          {quota && isApiError(error) ? (
            // Plan quota (429 quota_exceeded): the backend message names the limit; it's not a rate limit.
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/[0.07] px-3 py-2 text-[13px] text-fg">
              <GaugeIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <span>{error.message || "Your plan's automation limit was reached."}</span>
            </div>
          ) : (
            <InlineError error={error} />
          )}
          {quota && (
            <p className="text-xs text-fg-muted">
              Delete an automation you no longer need, or{" "}
              <Link href="/app/billing" className="text-accent underline-offset-4 hover:underline">
                upgrade your plan
              </Link>
              .
            </p>
          )}
          {conflict && (
            <p className="text-xs text-fg-muted">
              Close this dialog to load the latest version, then make your change again.
            </p>
          )}
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={isSubmitting}>
          {editing ? "Save changes" : "Create automation"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <h3 className="text-sm font-semibold tracking-tight text-fg">{title}</h3>
      {children}
    </section>
  );
}
