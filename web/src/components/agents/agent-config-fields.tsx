"use client";

import { AlertTriangleIcon, ChevronDownIcon } from "lucide-react";
import * as React from "react";
import { Controller, useWatch, type UseFormReturn } from "react-hook-form";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/controls";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import type { ToolOut } from "@/lib/api";
import { cn } from "@/lib/utils";
import { agentToolAccess, matchingNames, patternSuggestions } from "@/components/tools/glob";
import { LIMITS, PLANNING_TIERS, toolPatternSchema, type AgentConfigValues } from "./agent-form";
import { ChipsInput } from "./chips-input";

export const CONFIG_SECTIONS = [
  { id: "instructions", label: "Instructions" },
  { id: "model", label: "Model policy" },
  { id: "tools", label: "Tool policy" },
  { id: "memory", label: "Memory" },
  { id: "limits", label: "Execution limits" },
  { id: "verification", label: "Verification" },
] as const;

const TIER_COPY: Record<(typeof PLANNING_TIERS)[number], { label: string; description: string }> = {
  fast: { label: "Fast", description: "Lowest latency for simple, well-defined goals." },
  default: { label: "Default", description: "Balanced quality and speed." },
  reasoning: { label: "Reasoning", description: "Deeper planning for complex, multi-step goals." },
};

export function ConfigSection({
  id,
  title,
  description,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const headingId = `${id}-heading`;
  return (
    <Card id={`section-${id}`} aria-labelledby={headingId} role="region" className={cn("scroll-mt-24", className)}>
      <div className="border-b border-line px-5 py-4">
        <h2 id={headingId} className="text-sm font-semibold tracking-tight text-fg">
          {title}
        </h2>
        {description && <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{description}</p>}
      </div>
      <div className="flex flex-col gap-5 px-5 py-5">{children}</div>
    </Card>
  );
}

function NumberField({
  form,
  name,
  label,
  description,
  unit,
  placeholder = "No limit",
  step,
}: {
  form: UseFormReturn<AgentConfigValues>;
  name: keyof AgentConfigValues;
  label: string;
  description?: string;
  unit?: string;
  placeholder?: string;
  step?: string;
}) {
  const error = form.formState.errors[name]?.message as string | undefined;
  return (
    <Field label={label} description={description} error={error}>
      {(ids) => (
        <div className="relative">
          <Input
            {...ids}
            {...form.register(name)}
            inputMode={step ? "decimal" : "numeric"}
            placeholder={placeholder}
            className={cn("font-mono tabular-nums", unit && "pr-14")}
            autoComplete="off"
          />
          {unit && (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-fg-subtle" aria-hidden>
              {unit}
            </span>
          )}
        </div>
      )}
    </Field>
  );
}

/** Live preview of which catalogue tools an allow/deny policy permits (same matching as the backend). */
function ToolAccessPreview({ allowed, denied, tools }: { allowed: string[]; denied: string[]; tools: ToolOut[] | undefined }) {
  const [open, setOpen] = React.useState(false);
  const names = React.useMemo(() => (tools ?? []).map((t) => t.name), [tools]);
  const { permitted, blocked } = React.useMemo(() => agentToolAccess(names, allowed, denied), [names, allowed, denied]);
  const listId = React.useId();
  if (!tools) return null;
  return (
    <div className="rounded-lg border border-line bg-surface-2/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={listId}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <span className="text-fg-muted">
          <span className="font-medium text-fg tabular-nums">{permitted.length}</span> of {names.length} catalogue tools permitted
          {blocked.length > 0 && <span className="text-fg-subtle"> · {blocked.length} excluded</span>}
        </span>
        <ChevronDownIcon className={cn("size-4 text-fg-subtle transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div id={listId} className="grid gap-4 border-t border-line px-3 py-3 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-2xs font-medium uppercase tracking-wider text-success">Permitted</p>
            <ul className="flex flex-wrap gap-1">
              {permitted.length === 0 && <li className="text-xs text-fg-subtle">None</li>}
              {permitted.map((n) => (
                <li key={n} className="rounded border border-success/25 bg-success/8 px-1.5 font-mono text-2xs text-fg">
                  {n}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1.5 text-2xs font-medium uppercase tracking-wider text-fg-subtle">Excluded</p>
            <ul className="flex flex-wrap gap-1">
              {blocked.length === 0 && <li className="text-xs text-fg-subtle">None</li>}
              {blocked.map((n) => (
                <li key={n} className="rounded border border-line px-1.5 font-mono text-2xs text-fg-subtle">
                  {n}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function validatePattern(v: string): string | null {
  const r = toolPatternSchema.safeParse(v);
  return r.success ? null : (r.error.issues[0]?.message ?? "Invalid pattern");
}

/**
 * All versioned configuration fields of an agent. Used by "Create agent" and "New version".
 */
export function AgentConfigFields({
  form,
  tools,
  toolsError,
}: {
  form: UseFormReturn<AgentConfigValues>;
  tools?: ToolOut[];
  toolsError?: boolean;
}) {
  const { errors } = form.formState;
  const instructions = useWatch({ control: form.control, name: "instructions" }) ?? "";
  const allowed = useWatch({ control: form.control, name: "allowedTools" }) ?? [];
  const denied = useWatch({ control: form.control, name: "deniedTools" }) ?? [];
  const memoryEnabled = useWatch({ control: form.control, name: "memoryEnabled" });
  const tier = useWatch({ control: form.control, name: "planningTier" });

  const names = React.useMemo(() => (tools ?? []).map((t) => t.name), [tools]);
  const suggestions = React.useMemo(() => patternSuggestions(names), [names]);
  const describeMatch = React.useCallback(
    (p: string) => {
      const n = matchingNames(p, names).length;
      return `${n} ${n === 1 ? "tool" : "tools"}`;
    },
    [names],
  );
  const unmatched = (p: string) => (names.length > 0 && matchingNames(p, names).length === 0 ? "border-warning/40 text-warning" : undefined);

  return (
    <div className="flex flex-col gap-5">
      <ConfigSection
        id="instructions"
        title="Instructions"
        description="How this agent should behave: tone, priorities, what to confirm and what to avoid. Added to every plan the agent makes."
      >
        <Field error={errors.instructions?.message} label={<span className="sr-only">Instructions</span>}>
          {(ids) => (
            <div className="flex flex-col gap-1.5">
              <Textarea
                {...ids}
                {...form.register("instructions")}
                rows={14}
                spellCheck
                placeholder={"e.g. You schedule meetings for the sales team.\nAlways propose times within 09:00–17:00 in the attendee's timezone.\nNever send an invitation without confirming the attendee list."}
                className="min-h-72 text-[13.5px] leading-relaxed"
              />
              <p className={cn("self-end text-2xs tabular-nums", instructions.length > LIMITS.instructions ? "text-danger" : "text-fg-subtle")}>
                {instructions.length.toLocaleString("en-US")} / {LIMITS.instructions.toLocaleString("en-US")}
              </p>
            </div>
          )}
        </Field>
      </ConfigSection>

      <ConfigSection
        id="model"
        title="Model policy"
        description="Which model tier plans this agent's tasks, and optional model overrides. Empty overrides use the platform model for each tier."
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-medium text-fg">
            Planning tier
          </legend>
          <Controller
            control={form.control}
            name="planningTier"
            render={({ field }) => (
              <div className="grid gap-2 sm:grid-cols-3">
                {PLANNING_TIERS.map((t) => {
                  const checked = field.value === t;
                  return (
                    <label
                      key={t}
                      className={cn(
                        "flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-accent/40",
                        checked ? "border-accent/50 bg-accent/8" : "border-line-strong bg-surface-1 hover:bg-surface-2",
                      )}
                    >
                      <span className="flex items-center gap-2 text-[13px] font-medium text-fg">
                        <input
                          type="radio"
                          name={field.name}
                          value={t}
                          checked={checked}
                          onChange={() => field.onChange(t)}
                          onBlur={field.onBlur}
                          className="size-3.5 accent-[var(--color-accent)]"
                        />
                        {TIER_COPY[t].label}
                      </span>
                      <span className="pl-5.5 text-xs text-fg-muted">{TIER_COPY[t].description}</span>
                    </label>
                  );
                })}
              </div>
            )}
          />
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-3">
          {(
            [
              ["defaultModel", "Default model", "Used for any tier without its own override."],
              ["fastModel", "Fast model", "Override for the fast tier."],
              ["reasoningModel", "Reasoning model", "Override for the reasoning tier."],
            ] as const
          ).map(([name, label, description]) => (
            <Field key={name} label={label} description={description} error={errors[name]?.message}>
              {(ids) => (
                <Input {...ids} {...form.register(name)} placeholder="Platform default" className="font-mono text-[13px]" autoComplete="off" spellCheck={false} />
              )}
            </Field>
          ))}
        </div>
        <Field
          label="Fallback models"
          description={`Tried in order when the preferred model is unavailable (up to ${LIMITS.fallbacks}).`}
          error={errors.fallbacks?.message ?? (Array.isArray(errors.fallbacks) ? errors.fallbacks.find(Boolean)?.message : undefined)}
        >
          {(ids) => (
            <Controller
              control={form.control}
              name="fallbacks"
              render={({ field }) => (
                <ChipsInput
                  {...ids}
                  value={field.value}
                  onChange={field.onChange}
                  max={LIMITS.fallbacks}
                  placeholder="Type a model id and press Enter"
                  validate={(v) => (v.length > LIMITS.modelName ? `At most ${LIMITS.modelName} characters` : /\s/.test(v) ? "Model ids cannot contain spaces" : null)}
                />
              )}
            />
          )}
        </Field>
        <p className="text-xs text-fg-subtle">
          Planning uses the <span className="font-medium text-fg-muted">{TIER_COPY[tier ?? "default"].label.toLowerCase()}</span> tier: its override (or the default model) first, then the fallbacks, then the platform models.
        </p>
      </ConfigSection>

      <ConfigSection
        id="tools"
        title="Tool policy"
        description={
          <>
            Which tools this agent may request. A tool is permitted when it matches an allowed pattern and no denied pattern
            (<code className="font-mono text-fg">*</code> matches any characters). Organization rules, connections and approvals still
            apply on top.
          </>
        }
      >
        {toolsError && <p className="text-xs text-warning">The tool catalogue could not be loaded, so suggestions are unavailable. You can still type patterns.</p>}
        <Field
          label="Allowed tools"
          description="Tool names or patterns, e.g. calendar.* or gmail.search."
          error={errors.allowedTools?.message ?? (Array.isArray(errors.allowedTools) ? errors.allowedTools.find(Boolean)?.message : undefined)}
        >
          {(ids) => (
            <Controller
              control={form.control}
              name="allowedTools"
              render={({ field }) => (
                <ChipsInput
                  {...ids}
                  value={field.value}
                  onChange={field.onChange}
                  suggestions={["*", ...suggestions]}
                  describe={describeMatch}
                  validate={validatePattern}
                  max={LIMITS.toolPatterns}
                  chipClassName={unmatched}
                  placeholder="Type a tool or pattern…"
                />
              )}
            />
          )}
        </Field>
        {allowed.length === 0 && (
          <p role="status" className="-mt-2 flex items-center gap-1.5 text-xs text-warning">
            <AlertTriangleIcon className="size-3.5" aria-hidden /> No tools allowed — this agent can only answer directly.
          </p>
        )}
        <Field
          label="Denied tools"
          description="Always excluded, even when an allowed pattern matches."
          error={errors.deniedTools?.message ?? (Array.isArray(errors.deniedTools) ? errors.deniedTools.find(Boolean)?.message : undefined)}
        >
          {(ids) => (
            <Controller
              control={form.control}
              name="deniedTools"
              render={({ field }) => (
                <ChipsInput
                  {...ids}
                  value={field.value}
                  onChange={field.onChange}
                  suggestions={suggestions}
                  describe={describeMatch}
                  validate={validatePattern}
                  max={LIMITS.toolPatterns}
                  chipClassName={(p) => unmatched(p) ?? "border-danger/30 bg-danger/8"}
                  placeholder="e.g. gmail.send"
                />
              )}
            />
          )}
        </Field>
        <ToolAccessPreview allowed={allowed} denied={denied} tools={tools} />
      </ConfigSection>

      <ConfigSection id="memory" title="Memory" description="Whether the agent recalls saved memories when planning and learns new ones from finished tasks.">
        <Controller
          control={form.control}
          name="memoryEnabled"
          render={({ field }) => (
            <SwitchRow
              label="Use memory"
              description="Retrieve relevant memories for each task."
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
        <div className={cn("grid gap-4 sm:grid-cols-2", !memoryEnabled && "opacity-60")}>
          <NumberField
            form={form}
            name="memoryMaxItems"
            label="Memories per task"
            description={`${LIMITS.memoryMaxItems.min}–${LIMITS.memoryMaxItems.max}. How many memories are added to the planning context.`}
            placeholder="8"
          />
        </div>
        <Controller
          control={form.control}
          name="memoryExtractAfterTask"
          render={({ field }) => (
            <SwitchRow
              label="Extract memories after each task"
              description="Propose new memories from what the task learned."
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
      </ConfigSection>

      <ConfigSection
        id="limits"
        title="Execution limits"
        description="Hard ceilings for a single task run with this agent. Leave a field empty for no agent-level limit (organization and plan limits still apply)."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField form={form} name="maxSteps" label="Max steps" description="1–100 plan steps." />
          <NumberField form={form} name="maxToolCalls" label="Max tool calls" description="1–1,000." />
          <NumberField form={form} name="maxModelCalls" label="Max model calls" description="1–500." />
          <NumberField form={form} name="maxDurationSeconds" label="Max duration" description="10 s – 7 days." unit="sec" />
          <NumberField form={form} name="maxCostUsd" label="Max cost" description="0–1,000 USD." unit="USD" step="0.01" />
          <NumberField form={form} name="maxBrowserActions" label="Max browser actions" description="0–1,000. 0 disables browser actions." />
        </div>
      </ConfigSection>

      <ConfigSection
        id="verification"
        title="Verification"
        description="Writes are always verified against the external system; these settings tune how AgentOS reads results back before deciding."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField form={form} name="readbackAttempts" label="Read-back attempts" description="1–10 reads before the result is inconclusive." placeholder="3" />
          <NumberField form={form} name="readbackDelayMs" label="Delay between reads" description="0–30,000 ms." unit="ms" placeholder="500" />
        </div>
      </ConfigSection>
    </div>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  const id = React.useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-[13px] font-medium text-fg">
          {label}
        </label>
        <p id={`${id}-d`} className="mt-0.5 text-xs text-fg-subtle">
          {description}
        </p>
      </div>
      <Switch id={id} aria-describedby={`${id}-d`} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

/** Sticky in-page navigation for the configuration sections (desktop). */
export function ConfigSectionNav({ extra = [] }: { extra?: Array<{ id: string; label: string }> }) {
  const items = [...extra, ...CONFIG_SECTIONS];
  return (
    <nav aria-label="Configuration sections" className="sticky top-20 hidden flex-col gap-0.5 lg:flex">
      {items.map((s) => (
        <a
          key={s.id}
          href={`#section-${s.id}`}
          onClick={(e) => {
            const el = document.getElementById(`section-${s.id}`);
            if (!el) return;
            e.preventDefault();
            const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
          }}
          className="rounded-md px-2.5 py-1.5 text-[13px] text-fg-muted transition-colors hover:bg-white/[0.04] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}
