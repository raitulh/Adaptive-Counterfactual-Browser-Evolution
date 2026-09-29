"use client";

import { ChevronDownIcon } from "lucide-react";
import * as React from "react";
import { Card } from "@/components/ui/card";
import { IdChip, JsonViewer, KeyValue } from "@/components/ui/data-display";
import type { AgentOut, AgentVersionOut, ToolOut } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { agentToolAccess } from "@/components/tools/glob";
import { FIELD_LABELS, formatFieldValue, normalizeConfig, type SectionKey } from "./version-diff";

function Panel({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="border-b border-line px-5 py-3">
        <h3 className="text-sm font-semibold tracking-tight text-fg">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-fg-subtle">{description}</p>}
      </div>
      <div className="px-5 py-4">{children}</div>
    </Card>
  );
}

function fieldItems(
  section: SectionKey,
  values: Record<string, unknown>,
  fields: string[],
): Array<[React.ReactNode, React.ReactNode]> {
  return fields.map((f) => {
    const v = values[f] as string | number | boolean | null;
    const text = formatFieldValue(section, f, v);
    const unset = v === null || v === undefined || v === "";
    const mono = section === "model_policy" && f !== "planning_tier" && !unset;
    return [
      FIELD_LABELS[section][f],
      <span key={f} className={cn(unset && "text-fg-subtle", mono && "font-mono text-xs")}>
        {text}
      </span>,
    ];
  });
}

function Patterns({ items, tone }: { items: string[]; tone: "allow" | "deny" }) {
  if (items.length === 0)
    return <span className="text-[13px] text-fg-subtle">{tone === "allow" ? "None — no tools" : "None"}</span>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((p) => (
        <li
          key={p}
          className={cn(
            "rounded border px-1.5 py-0.5 font-mono text-xs",
            tone === "allow" ? "border-line-strong bg-surface-2 text-fg" : "border-danger/30 bg-danger/8 text-fg",
          )}
        >
          {p}
        </li>
      ))}
    </ul>
  );
}

export function InstructionsBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const long = text.split("\n").length > 14 || text.length > 1200;
  if (!text.trim())
    return (
      <p className="text-[13px] text-fg-subtle italic">
        No instructions — the agent plans with the platform defaults only.
      </p>
    );
  return (
    <div className="relative">
      <div
        className={cn(
          "text-[13.5px] leading-relaxed break-words whitespace-pre-wrap text-fg",
          long && !expanded && "max-h-72 overflow-hidden",
        )}
      >
        {text}
      </div>
      {long && !expanded && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface-1 to-transparent"
          aria-hidden
        />
      )}
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="relative mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:outline-none"
        >
          {expanded ? "Show less" : "Show all instructions"}
          <ChevronDownIcon className={cn("size-3.5 transition-transform", expanded && "rotate-180")} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** The current configuration rendered readably (raw JSON only in developer mode). */
export function AgentOverview({
  agent,
  version,
  tools,
}: {
  agent: AgentOut;
  version: AgentVersionOut;
  tools?: ToolOut[];
}) {
  const developerMode = useUiStore((s) => s.developerMode);
  const c = normalizeConfig(version);
  const access = tools
    ? agentToolAccess(
        tools.map((t) => t.name),
        c.tool_policy.allowed,
        c.tool_policy.denied,
      )
    : null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel
        title="Instructions"
        description={`${c.instructions.length.toLocaleString("en-US")} characters`}
        className="lg:col-span-2"
      >
        <InstructionsBlock text={c.instructions} />
      </Panel>

      <Panel title="Model policy" description="Tier used for planning and model overrides.">
        <KeyValue
          items={fieldItems("model_policy", c.model_policy, ["planning_tier", "default", "fast", "reasoning"])}
        />
        <div className="mt-3 flex flex-col gap-1.5">
          <span className="text-[13px] text-fg-subtle">Fallback models</span>
          {c.model_policy.fallbacks.length === 0 ? (
            <span className="text-[13px] text-fg-subtle">None — platform fallbacks</span>
          ) : (
            <ol className="flex flex-wrap items-center gap-1.5">
              {c.model_policy.fallbacks.map((m, i) => (
                <li
                  key={m}
                  className="rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg"
                >
                  <span className="mr-1 text-fg-subtle">{i + 1}.</span>
                  {m}
                </li>
              ))}
            </ol>
          )}
        </div>
      </Panel>

      <Panel
        title="Tool policy"
        description={
          access
            ? `${access.permitted.length} of ${access.permitted.length + access.blocked.length} catalogue tools permitted for this agent.`
            : "Tools this agent may request."
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] text-fg-subtle">Allowed</span>
            <Patterns items={c.tool_policy.allowed} tone="allow" />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] text-fg-subtle">Denied</span>
            <Patterns items={c.tool_policy.denied} tone="deny" />
          </div>
        </div>
      </Panel>

      <Panel title="Memory">
        <KeyValue
          items={fieldItems("memory_policy", c.memory_policy, ["enabled", "max_items", "extract_after_task"])}
        />
      </Panel>

      <Panel title="Verification" description="Writes are always verified; read-back tuning.">
        <KeyValue
          items={fieldItems("verification_policy", c.verification_policy, ["readback_attempts", "readback_delay_ms"])}
        />
      </Panel>

      <Panel
        title="Execution limits"
        description="Per-task ceilings. Organization and plan limits also apply."
        className="lg:col-span-2"
      >
        <KeyValue
          className="sm:grid-cols-[minmax(9rem,auto)_1fr_minmax(9rem,auto)_1fr]"
          items={fieldItems("execution_limits", c.execution_limits, [
            "max_steps",
            "max_tool_calls",
            "max_model_calls",
            "max_duration_seconds",
            "max_cost_usd",
            "max_browser_actions",
          ])}
        />
      </Panel>

      {developerMode && (
        <Panel title="Developer details" className="lg:col-span-2">
          <div className="mb-3 flex flex-wrap gap-2">
            <IdChip id={agent.id} label="agent" />
            <IdChip id={version.id} label="version" />
          </div>
          <JsonViewer value={version} />
        </Panel>
      )}
    </div>
  );
}
