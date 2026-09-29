"use client";

/** Right-hand live state: execution graph, verification evidence and tool activity. */
import { ShieldCheckIcon, WrenchIcon } from "lucide-react";
import * as React from "react";
import type { TaskDetailView } from "@/lib/api";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { clockTime, durationMs } from "@/lib/format";
import { toneClasses } from "@/lib/status";
import { cn } from "@/lib/utils";
import { VerificationComparison } from "./recovery-panel";
import { PlanGraph } from "./timeline/plan-graph";
import { verificationMethodLabel, type TimelineEntry } from "./timeline/normalize";
import { toolIcon } from "./timeline/tool-meta";
import { readable } from "./timeline/readable";

function VerificationList({ task, entries }: { task: TaskDetailView; entries: readonly TimelineEntry[] }) {
  const [open, setOpen] = React.useState<string | null>(null);
  const stepName = (id: string | null) => task.steps.find((s) => s.id === id)?.action ?? "Task result";
  const running = entries.filter((e) => e.kind === "verification" && e.state === "active");
  const records = [...task.verifications].reverse();
  if (records.length === 0 && running.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={<ShieldCheckIcon />}
        title="Nothing verified yet"
        description="After every action AgentOS reads the result back from the external system before calling it done."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {running.map((e) => (
        <li key={e.key} className="flex items-center gap-2.5 rounded-lg border border-verify/30 bg-verify/5 px-3 py-2.5 text-[13px]" role="status">
          <span className="relative flex size-5 items-center justify-center text-verify" aria-hidden>
            <svg viewBox="0 0 20 20" className="absolute inset-0 motion-safe:animate-spin-slow">
              <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="6 4" />
            </svg>
            <ShieldCheckIcon className="size-3" />
          </span>
          <span className="min-w-0 flex-1 truncate text-fg">{e.stepLabel ?? e.title}</span>
          <span className="text-2xs text-verify">Verifying</span>
        </li>
      ))}
      {records.map((v) => (
        <li key={v.id} className="rounded-lg border border-line bg-surface-1">
          <button
            type="button"
            onClick={() => setOpen((o) => (o === v.id ? null : v.id))}
            aria-expanded={open === v.id}
            className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left outline-none hover:bg-surface-2/60 focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <ShieldCheckIcon className={cn("mt-0.5 size-4 shrink-0", v.status === "passed" ? "text-verify" : v.status === "failed" ? "text-danger" : "text-recover")} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-fg">{stepName(v.step_id)}</span>
              <span className="block truncate text-2xs text-fg-subtle">
                {verificationMethodLabel(v.method)} · {clockTime(v.verified_at)}
              </span>
            </span>
            <StatusBadge kind="verification" value={v.status} />
          </button>
          {open === v.id && (
            <div className="border-t border-line p-3">
              <VerificationComparison verification={v} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function ToolActivity({ entries }: { entries: readonly TimelineEntry[] }) {
  const calls = entries.filter((e) => e.kind === "tool_call");
  if (calls.length === 0) {
    return <EmptyState size="sm" icon={<WrenchIcon />} title="No tool calls yet" description="Each call to Calendar, Gmail, Drive or the web shows up here with its duration and result." />;
  }
  const total = calls.reduce((sum, c) => sum + (c.durationMs ?? 0), 0);
  const failed = calls.filter((c) => c.state === "failed").length;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-fg-muted">
        {calls.length} call{calls.length === 1 ? "" : "s"} · {durationMs(total)} in tools{failed ? ` · ${failed} failed` : ""}
      </p>
      <ul className="flex flex-col gap-1.5">
        {[...calls].reverse().map((c) => {
          const tone = c.state === "failed" ? "danger" : c.state === "active" ? "accent" : "neutral";
          return (
            <li key={c.key} className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-1 px-3 py-2">
              <span className={cn("relative mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md", toneClasses[tone].soft, toneClasses[tone].text)} aria-hidden>
                {c.state === "active" && <span className="absolute inset-0 rounded-md bg-accent/25 motion-safe:animate-pulse-ring" />}
                {React.createElement(toolIcon(c.tool), { className: "relative size-3.5" })}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[13px] text-fg">{c.toolLabel ?? c.title}</span>
                  {c.attempt && c.attempt > 1 && <span className="text-2xs text-recover">#{c.attempt}</span>}
                  <span className="ml-auto shrink-0 font-mono text-2xs tabular-nums text-fg-subtle">
                    {c.state === "active" ? "running" : c.durationMs != null ? durationMs(c.durationMs) : "—"}
                  </span>
                </span>
                <code className="block truncate font-mono text-2xs text-fg-subtle">{c.tool}</code>
                {c.detail && <span className={cn("mt-0.5 block text-xs", c.state === "failed" ? "text-danger/90" : "text-fg-muted")}>{readable(c.detail)}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function LiveStatePanel({
  task,
  entries,
  onSelectStep,
  className,
}: {
  task: TaskDetailView;
  entries: readonly TimelineEntry[];
  onSelectStep?: (stepId: string) => void;
  className?: string;
}) {
  const [tab, setTab] = React.useState("plan");
  const verifying = entries.some((e) => e.kind === "verification" && e.state === "active");
  const running = entries.some((e) => e.kind === "tool_call" && e.state === "active");
  return (
    <Tabs value={tab} onValueChange={setTab} className={className}>
      <TabsList className="w-full" aria-label="Live state">
        <TabsTrigger value="plan" className="flex-1">
          Plan
        </TabsTrigger>
        <TabsTrigger value="verification" className="flex-1">
          Verification
          {verifying && <span className="size-1.5 rounded-full bg-verify motion-safe:animate-signal" aria-label="(verifying now)" />}
        </TabsTrigger>
        <TabsTrigger value="tools" className="flex-1">
          Tools
          {running && <span className="size-1.5 rounded-full bg-accent motion-safe:animate-signal" aria-label="(running now)" />}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="plan">
        <PlanGraph plan={task.plan} steps={task.steps} planVersion={task.plan_version} taskStatus={task.status} goal={task.goal} onSelectStep={onSelectStep} />
      </TabsContent>
      <TabsContent value="verification">
        <VerificationList task={task} entries={entries} />
      </TabsContent>
      <TabsContent value="tools">
        <ToolActivity entries={entries} />
      </TabsContent>
    </Tabs>
  );
}
