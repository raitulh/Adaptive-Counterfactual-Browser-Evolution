"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, PlayIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, RadioGroup, RadioGroupItem } from "@/components/ui/controls";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InlineError } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import {
  evaluationsApi,
  newIdempotencyKey,
  type EvaluationRunCreate,
  type StrategyConfig,
  type SuiteOut,
} from "@/lib/api";
import { usePermissions } from "@/lib/auth/hooks";
import { humanize } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { cn } from "@/lib/utils";
import { applyFieldErrors } from "@/components/settings/form-errors";

export function parseStrategyJson(text: string): { value: StrategyConfig | null; error: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { value: null, error: null };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return { value: null, error: "Must be a JSON object" };
    return { value: parsed as StrategyConfig, error: null };
  } catch (e) {
    return { value: null, error: e instanceof Error ? `Invalid JSON: ${e.message}` : "Invalid JSON" };
  }
}

const schema = z.object({
  suite: z.string().regex(/^[a-z0-9_-]{1,80}$/, "Choose a suite"),
  label: z.string().regex(/^[A-Za-z0-9_.+:-]{1,80}$/, "Letters, digits and _ . + : - only (max 80)"),
  model_mode: z.enum(["scripted", "configured"]),
  repetitions: z.number().int("Whole number").min(1, "At least 1").max(10, "At most 10"),
  case_ids: z.array(z.string()),
  platform: z.boolean(),
  strategy: z.string().superRefine((v, ctx) => {
    const r = parseStrategyJson(v);
    if (r.error) ctx.addIssue({ code: "custom", message: r.error });
  }),
});
type Values = z.infer<typeof schema>;

export function StartRunDialog({
  open,
  onOpenChange,
  suites,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suites: SuiteOut[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isPlatformAdmin } = usePermissions();
  const keyRef = React.useRef<string | null>(null);
  const [advanced, setAdvanced] = React.useState(false);
  const defaults: Values = {
    suite: suites[0]?.name ?? "core",
    label: "baseline",
    model_mode: "scripted",
    repetitions: 1,
    case_ids: [],
    platform: false,
    strategy: "",
  };
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });
  const { register, control, handleSubmit, formState, reset, setError, setValue } = form;
  const suiteName = useWatch({ control, name: "suite" });
  const caseIds = useWatch({ control, name: "case_ids" });
  const suite = suites.find((s) => s.name === suiteName);

  const start = useMutation({
    mutationFn: (v: Values) => {
      keyRef.current ??= newIdempotencyKey();
      const body: EvaluationRunCreate = {
        suite: v.suite,
        label: v.label,
        model_mode: v.model_mode,
        repetitions: v.repetitions,
        case_ids: v.case_ids.length ? v.case_ids : null,
        platform: isPlatformAdmin ? v.platform : false,
        strategy: parseStrategyJson(v.strategy).value,
      };
      return evaluationsApi.start(body, keyRef.current);
    },
    onSuccess: (run) => {
      keyRef.current = null;
      void queryClient.invalidateQueries({ queryKey: qk.evaluations.list });
      toast.success("Evaluation run queued", { description: `${run.suite} · ${run.strategy_label}` });
      close(false);
      router.push(`/app/evaluations/${run.id}`);
    },
    onError: (err) => {
      applyFieldErrors(err, setError, [
        "suite",
        "label",
        "model_mode",
        "repetitions",
        "case_ids",
        "platform",
        "strategy",
      ]);
    },
  });

  function close(next: boolean) {
    if (!next) {
      reset(defaults);
      start.reset();
      keyRef.current = null;
      setAdvanced(false);
    }
    onOpenChange(next);
  }

  const toggleCase = (id: string, on: boolean) => {
    const next = on ? [...caseIds, id] : caseIds.filter((c) => c !== id);
    setValue("case_ids", next, { shouldDirty: true });
    keyRef.current = null; // a different request is a new logical submission
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="lg">
        <form onSubmit={handleSubmit((v) => start.mutate(v))} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>New evaluation run</DialogTitle>
            <DialogDescription>
              Runs every selected case of a suite in isolated, simulated environments and scores success, safety and
              cost. Nothing touches real accounts.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Suite" error={formState.errors.suite?.message}>
                {(ids) => (
                  <Controller
                    control={control}
                    name="suite"
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={(v) => {
                          field.onChange(v);
                          setValue("case_ids", []);
                          keyRef.current = null;
                        }}
                      >
                        <SelectTrigger {...ids}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {suites.map((s) => (
                            <SelectItem key={s.name} value={s.name}>
                              <span className="font-mono">{s.name}</span>{" "}
                              <span className="text-fg-subtle">· {s.cases.length} cases</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                )}
              </Field>
              <Field
                label="Label"
                error={formState.errors.label?.message}
                description="Tags the run (e.g. baseline, retry-tuning-v2)."
              >
                {(ids) => (
                  <Input
                    {...ids}
                    className="font-mono"
                    {...register("label", { onChange: () => (keyRef.current = null) })}
                  />
                )}
              </Field>
            </div>

            <Field label="Planner" error={formState.errors.model_mode?.message}>
              {(ids) => (
                <Controller
                  control={control}
                  name="model_mode"
                  render={({ field }) => (
                    <RadioGroup
                      aria-describedby={ids["aria-describedby"]}
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        keyRef.current = null;
                      }}
                      className="grid gap-2 sm:grid-cols-2"
                    >
                      {(
                        [
                          [
                            "scripted",
                            "Scripted (deterministic)",
                            "Each case's recorded plan. Reproducible; cases that need a live model are skipped.",
                          ],
                          [
                            "configured",
                            "Configured model",
                            "Uses the deployment's configured model for model-driven cases. Costs model usage.",
                          ],
                        ] as const
                      ).map(([value, title, desc]) => (
                        <label
                          key={value}
                          className={cn(
                            "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors",
                            field.value === value
                              ? "border-accent/50 bg-accent/[0.06]"
                              : "border-line hover:border-line-strong",
                          )}
                        >
                          <RadioGroupItem value={value} className="mt-0.5" />
                          <span>
                            <span className="block text-[13px] font-medium text-fg">{title}</span>
                            <span className="block text-xs text-fg-subtle">{desc}</span>
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                  )}
                />
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Repetitions"
                error={formState.errors.repetitions?.message}
                description="Runs each case 1–10 times to measure consistency."
              >
                {(ids) => (
                  <Input
                    {...ids}
                    type="number"
                    min={1}
                    max={10}
                    className="w-28"
                    {...register("repetitions", { valueAsNumber: true, onChange: () => (keyRef.current = null) })}
                  />
                )}
              </Field>
              {isPlatformAdmin && (
                <Controller
                  control={control}
                  name="platform"
                  render={({ field }) => (
                    <label className="flex items-start gap-3 rounded-lg border border-line p-3 sm:mt-6">
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(v) => {
                          field.onChange(v === true);
                          keyRef.current = null;
                        }}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="flex items-center gap-2 text-[13px] font-medium text-fg">
                          Platform-level run <Badge tone="verify">Admin</Badge>
                        </span>
                        <span className="block text-xs text-fg-subtle">
                          Not tied to this organization; visible to platform administrators.
                        </span>
                      </span>
                    </label>
                  )}
                />
              )}
            </div>

            {suite && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 flex w-full items-center justify-between text-[13px] font-medium text-fg">
                  Cases
                  <span className="text-xs font-normal text-fg-subtle">
                    {caseIds.length
                      ? `${caseIds.length} of ${suite.cases.length} selected`
                      : `All ${suite.cases.length} cases`}
                  </span>
                </legend>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-line">
                  {suite.cases.map((c) => (
                    <label
                      key={c.id}
                      className="flex cursor-pointer items-start gap-3 border-b border-line px-3 py-2 last:border-0 hover:bg-white/[0.02]"
                    >
                      <Checkbox
                        checked={caseIds.includes(c.id)}
                        onCheckedChange={(v) => toggleCase(c.id, v === true)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-fg">{c.id}</span>
                          <Badge tone="neutral" variant="outline">
                            {humanize(c.category)}
                          </Badge>
                        </span>
                        <span className="block text-xs text-fg-subtle">{c.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {formState.errors.case_ids?.message && (
                  <p className="text-xs text-danger">{formState.errors.case_ids.message}</p>
                )}
              </fieldset>
            )}

            <div>
              <button
                type="button"
                onClick={() => setAdvanced((v) => !v)}
                aria-expanded={advanced}
                className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg"
              >
                <ChevronDownIcon
                  className={cn("size-3.5 transition-transform", advanced && "rotate-180")}
                  aria-hidden
                />
                Pin a strategy (advanced)
              </button>
              {advanced && (
                <Field
                  className="mt-3"
                  label="Strategy config (JSON)"
                  error={formState.errors.strategy?.message}
                  description="Optional StrategyConfig applied to every case, e.g. tool retry or verification read-back tuning. Validated by the server."
                >
                  {(ids) => (
                    <Textarea
                      {...ids}
                      rows={6}
                      spellCheck={false}
                      className="font-mono text-xs"
                      placeholder={
                        '{\n  "verification_readback": { "calendar.create_event": { "attempts": 5, "delay_ms": 800 } }\n}'
                      }
                      {...register("strategy", { onChange: () => (keyRef.current = null) })}
                    />
                  )}
                </Field>
              )}
            </div>
            {start.error && Object.keys(formState.errors).length === 0 ? <InlineError error={start.error} /> : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={start.isPending}>
              <PlayIcon /> Queue run
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
