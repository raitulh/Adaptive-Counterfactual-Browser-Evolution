"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, SplitIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
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
  experimentsApi,
  newIdempotencyKey,
  normalizeError,
  type ExperimentCreate,
  type StrategyConfig,
  type SuiteOut,
} from "@/lib/api";
import { usePermissions } from "@/lib/auth/hooks";
import { qk } from "@/lib/query/keys";
import { applyFieldErrors } from "@/components/settings/form-errors";
import { parseStrategyJson } from "@/components/evaluations/start-run-dialog";

export const EXPERIMENT_KINDS: ReadonlyArray<{ value: ExperimentCreate["kind"]; label: string; hint: string }> = [
  {
    value: "verification_strategy",
    label: "Verification strategy",
    hint: "Read-back attempts and delays after writes",
  },
  { value: "recovery_strategy", label: "Recovery strategy", hint: "Retry tuning for transient tool failures" },
  { value: "planner_strategy", label: "Planner strategy", hint: "Planner hints and browser locator order" },
  {
    value: "memory_retrieval",
    label: "Memory retrieval",
    hint: "Weights for semantic, keyword, recency and importance",
  },
  { value: "agent_version", label: "Agent version", hint: "Compare configurations of an agent" },
  { value: "acbe_strategy", label: "ACBE strategy", hint: "A learned strategy against the current one" },
];

const VARIANT_NAME = /^[a-z0-9_-]{1,40}$/;

const schema = z
  .object({
    name: z.string().trim().min(1, "Name the experiment").max(120),
    kind: z.enum([
      "agent_version",
      "planner_strategy",
      "memory_retrieval",
      "verification_strategy",
      "recovery_strategy",
      "acbe_strategy",
    ]),
    hypothesis: z.string().max(4000),
    evaluation_set: z.string().regex(/^[a-z0-9_-]{1,80}$/, "Choose an evaluation set"),
    repetitions: z.number().int("Whole number").min(1).max(10),
    platform: z.boolean(),
    variants: z
      .array(
        z.object({
          name: z.string().regex(VARIANT_NAME, "lowercase letters, digits, _ or - (max 40)"),
          weight: z.number().gt(0, "Must be > 0").max(100, "At most 100"),
          config: z.string().superRefine((v, ctx) => {
            const r = parseStrategyJson(v);
            if (r.error) ctx.addIssue({ code: "custom", message: r.error });
          }),
        }),
      )
      .min(2, "At least two variants: a control and a challenger")
      .max(5, "At most five variants"),
  })
  .superRefine((v, ctx) => {
    const seen = new Map<string, number>();
    v.variants.forEach((variant, i) => {
      if (seen.has(variant.name))
        ctx.addIssue({ code: "custom", path: ["variants", i, "name"], message: "Variant names must be unique" });
      seen.set(variant.name, i);
    });
  });
type Values = z.infer<typeof schema>;

const CONFIG_EXAMPLE =
  '{\n  "verification_readback": {\n    "calendar.create_event": { "attempts": 5, "delay_ms": 800 }\n  }\n}';

export function toExperimentPayload(v: Values, allowPlatform: boolean): ExperimentCreate {
  return {
    name: v.name.trim(),
    kind: v.kind,
    hypothesis: v.hypothesis.trim(),
    evaluation_set: v.evaluation_set,
    repetitions: v.repetitions,
    platform: allowPlatform ? v.platform : false,
    variants: v.variants.map((variant) => ({
      name: variant.name,
      weight: variant.weight,
      config: (parseStrategyJson(variant.config).value ?? {}) as StrategyConfig,
    })),
  };
}

export function CreateExperimentDialog({
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
  const defaults: Values = {
    name: "",
    kind: "verification_strategy",
    hypothesis: "",
    evaluation_set: suites.find((s) => s.name === "core")?.name ?? suites[0]?.name ?? "core",
    repetitions: 1,
    platform: false,
    variants: [
      { name: "control", weight: 1, config: "" },
      { name: "challenger", weight: 1, config: "" },
    ],
  };
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });
  const { register, control, handleSubmit, formState, reset, setError } = form;
  const variants = useFieldArray({ control, name: "variants" });

  const create = useMutation({
    mutationFn: (v: Values) => {
      keyRef.current ??= newIdempotencyKey();
      return experimentsApi.create(toExperimentPayload(v, isPlatformAdmin), keyRef.current);
    },
    onSuccess: (exp) => {
      keyRef.current = null;
      void queryClient.invalidateQueries({ queryKey: qk.experiments.list });
      toast.success("Experiment created", { description: "Start it to queue an evaluation run for every variant." });
      handleOpenChange(false);
      router.push(`/app/experiments/${exp.id}`);
    },
    onError: (err) => {
      const e = normalizeError(err);
      if (e.code === "unsafe_strategy") return; // shown inline below
      applyFieldErrors(err, setError, ["name", "kind", "hypothesis", "evaluation_set", "repetitions", "platform"]);
    },
  });

  function handleOpenChange(o: boolean) {
    if (!o) {
      reset(defaults);
      create.reset();
      keyRef.current = null;
    }
    onOpenChange(o);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="xl">
        <form
          onSubmit={handleSubmit((v) => create.mutate(v))}
          onChange={() => {
            // Any edit makes this a new logical submission (a new idempotency key).
            if (!create.isPending) keyRef.current = null;
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SplitIcon className="size-4 text-verify" aria-hidden /> New experiment
            </DialogTitle>
            <DialogDescription>
              Compare strategy variants on the same evaluation set. The first variant is the control. A statistical test
              with safety gates picks the winner; rolling it out always needs a person.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Name" error={formState.errors.name?.message}>
                {(ids) => <Input {...ids} autoFocus placeholder="Longer calendar read-back" {...register("name")} />}
              </Field>
              <Field label="Kind" error={formState.errors.kind?.message}>
                {(ids) => (
                  <Controller
                    control={control}
                    name="kind"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger {...ids}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EXPERIMENT_KINDS.map((k) => (
                            <SelectItem key={k.value} value={k.value}>
                              {k.label} <span className="text-fg-subtle">· {k.hint}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                )}
              </Field>
            </div>
            <Field
              label="Hypothesis"
              error={formState.errors.hypothesis?.message}
              description="What you expect to change and why. Shown with the results."
            >
              {(ids) => (
                <Textarea
                  {...ids}
                  rows={2}
                  placeholder="More read-back attempts will cut false verification failures on slow calendars without raising cost."
                  {...register("hypothesis")}
                />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Evaluation set" error={formState.errors.evaluation_set?.message}>
                {(ids) => (
                  <Controller
                    control={control}
                    name="evaluation_set"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
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
                label="Repetitions"
                error={formState.errors.repetitions?.message}
                description="Per case, per variant (1–10)."
              >
                {(ids) => (
                  <Input
                    {...ids}
                    type="number"
                    min={1}
                    max={10}
                    className="w-24"
                    {...register("repetitions", { valueAsNumber: true })}
                  />
                )}
              </Field>
              {isPlatformAdmin && (
                <Controller
                  control={control}
                  name="platform"
                  render={({ field }) => (
                    <label className="flex items-start gap-2.5 rounded-lg border border-line p-3 sm:mt-6">
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(v) => field.onChange(v === true)}
                        className="mt-0.5"
                      />
                      <span className="text-[13px] text-fg">
                        Platform-wide <Badge tone="verify">Admin</Badge>
                        <span className="block text-xs text-fg-subtle">Winner can roll out to every organization.</span>
                      </span>
                    </label>
                  )}
                />
              )}
            </div>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 flex w-full items-center justify-between text-[13px] font-medium text-fg">
                Variants
                <span className="text-xs font-normal text-fg-subtle">
                  {variants.fields.length} of 5 · configs are StrategyConfig JSON (empty = current strategy)
                </span>
              </legend>
              {variants.fields.map((f, i) => {
                const err = formState.errors.variants?.[i];
                return (
                  <div
                    key={f.id}
                    className="grid gap-3 rounded-lg border border-line bg-bg/40 p-3 md:grid-cols-[12rem_6rem_minmax(0,1fr)_auto]"
                  >
                    <Field label={i === 0 ? "Control name" : `Variant ${i + 1} name`} error={err?.name?.message}>
                      {(ids) => <Input {...ids} className="font-mono" {...register(`variants.${i}.name`)} />}
                    </Field>
                    <Field label="Weight" error={err?.weight?.message}>
                      {(ids) => (
                        <Input
                          {...ids}
                          type="number"
                          step="any"
                          min={0}
                          max={100}
                          {...register(`variants.${i}.weight`, { valueAsNumber: true })}
                        />
                      )}
                    </Field>
                    <Field label="Config" error={err?.config?.message}>
                      {(ids) => (
                        <Textarea
                          {...ids}
                          rows={i === 0 ? 2 : 4}
                          spellCheck={false}
                          className="font-mono text-xs"
                          placeholder={i === 0 ? "{}  (current strategy)" : CONFIG_EXAMPLE}
                          {...register(`variants.${i}.config`)}
                        />
                      )}
                    </Field>
                    <div className="flex items-end md:pb-0.5">
                      {i === 0 ? (
                        <Badge tone="info" className="md:mb-2">
                          Control
                        </Badge>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => variants.remove(i)}
                          disabled={variants.fields.length <= 2}
                          aria-label={`Remove variant ${i + 1}`}
                        >
                          <Trash2Icon />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
              {formState.errors.variants?.root?.message || formState.errors.variants?.message ? (
                <p className="text-xs text-danger">
                  {formState.errors.variants?.root?.message ?? formState.errors.variants?.message}
                </p>
              ) : null}
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={variants.fields.length >= 5}
                  onClick={() =>
                    variants.append({ name: `variant-${variants.fields.length + 1}`, weight: 1, config: "" })
                  }
                >
                  <PlusIcon /> Add variant
                </Button>
              </div>
            </fieldset>
            {create.error &&
            (normalizeError(create.error).code === "unsafe_strategy" || Object.keys(formState.errors).length === 0) ? (
              <InlineError error={create.error} />
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={create.isPending}>
              Create experiment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
