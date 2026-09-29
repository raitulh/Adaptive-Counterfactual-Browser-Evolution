"use client";

import { AlertTriangleIcon, ArrowRightIcon, CalendarClockIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon, WorkflowIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import {
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  LiveDot,
  PageContainer,
  PageHeader,
  RelativeTime,
  Skeleton,
  Tooltip,
} from "@/components/ui";
import type { AutomationOut } from "@/lib/api";
import { usePermissions } from "@/lib/auth/hooks";
import { cn } from "@/lib/utils";
import { DeleteAutomationDialog, EnabledSwitch, useRunNowAction } from "./automation-actions";
import { AutomationBuilderDialog, type BuilderDraft } from "./automation-builder";
import { disabledReasonMeta, presentAutomationState, presentLastStatus, readPolicy, readTemplate } from "./automation-status";
import { useAutomations } from "./hooks";
import { describeSchedule, formatInZone } from "./schedule";

const TEMPLATES: (BuilderDraft & { description: string })[] = [
  {
    name: "Weekday inbox digest",
    cron: "0 8 * * 1-5",
    goal: "Summarize my unread emails from the last 24 hours and list anything that needs a reply today.",
    description: "Every weekday at 08:00",
  },
  {
    name: "Monday week ahead",
    cron: "0 9 * * 1",
    goal: "Review my calendar for this week and summarize my meetings, any conflicts and my free focus time.",
    description: "Mondays at 09:00",
  },
  {
    name: "Friday wrap-up",
    cron: "0 16 * * 5",
    goal: "Draft a short summary of what happened this week based on my sent emails and calendar.",
    description: "Fridays at 16:00",
  },
];

export function AutomationsView() {
  const list = useAutomations();
  const { can } = usePermissions();
  const canManage = can("automations:manage");
  const [builder, setBuilder] = React.useState<{ open: boolean; automation?: AutomationOut | null; draft?: BuilderDraft }>({ open: false });
  const openCreate = (draft?: BuilderDraft) => setBuilder({ open: true, automation: null, draft });

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Autonomy"
        title="Automations"
        description="Recurring tasks on a schedule. Each run creates a real task — planned, approved, executed and verified like any other."
        actions={
          canManage ? (
            <Button variant="primary" onClick={() => openCreate()}>
              <PlusIcon aria-hidden /> New automation
            </Button>
          ) : undefined
        }
      />

      {list.isPending ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading automations">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-4 rounded-xl border border-line bg-surface-1 p-5">
              <div className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-lg" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="ml-auto h-5 w-9 rounded-full" />
              </div>
              <Skeleton className="h-3 w-72" />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((__, j) => (
                  <Skeleton key={j} className="h-9" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : list.isError && list.items.length === 0 ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        </Card>
      ) : list.items.length === 0 ? (
        <EmptyAutomations canManage={canManage} onCreate={openCreate} />
      ) : (
        <>
          <ul className="flex flex-col gap-3" aria-label="Automations">
            {list.items.map((a) => (
              <li key={a.id}>
                <AutomationCard automation={a} onEdit={() => setBuilder({ open: true, automation: a })} canManage={canManage} />
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button variant="ghost" size="sm" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}

      <AutomationBuilderDialog
        open={builder.open}
        onOpenChange={(open) => setBuilder((b) => ({ ...b, open }))}
        automation={builder.automation}
        draft={builder.draft}
      />
    </PageContainer>
  );
}

function AutomationCard({ automation: a, onEdit, canManage }: { automation: AutomationOut; onEdit: () => void; canManage: boolean }) {
  const state = presentAutomationState(a);
  const template = readTemplate(a.task_template);
  const policy = readPolicy(a.policy);
  const last = presentLastStatus(a.last_status);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const { trigger } = useRunNowAction();
  const reason = a.disabled_reason ? disabledReasonMeta[a.disabled_reason] : null;

  return (
    <Card className={cn("relative flex flex-col gap-4 p-4 transition-colors hover:border-line-strong sm:p-5", !a.enabled && "bg-surface-1/60")}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg border",
            a.enabled ? "border-accent/30 bg-accent/10 text-accent" : "border-line-strong bg-surface-2 text-fg-subtle",
          )}
        >
          <WorkflowIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-fg">
              <Link
                href={`/app/automations/${a.id}`}
                className="outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-accent/50"
              >
                {a.name}
              </Link>
            </h3>
            <Badge tone={state.tone}>{state.label}</Badge>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-fg-muted">
            <CalendarClockIcon className="size-3.5 text-fg-subtle" aria-hidden />
            <span>{describeSchedule(a.cron_expression)}</span>
            <code className="rounded border border-line bg-bg px-1.5 font-mono text-2xs text-fg-subtle">{a.cron_expression}</code>
            <span className="text-xs text-fg-subtle">{a.timezone.replace(/_/g, " ")}</span>
          </p>
          {template.goal && <p className="mt-1.5 line-clamp-1 text-[13px] text-fg-subtle">→ {template.goal}</p>}
        </div>
        <div className="relative z-10 flex shrink-0 items-center gap-1">
          <EnabledSwitch automation={a} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={`More actions for ${a.name}`}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/app/automations/${a.id}`}>
                  <ArrowRightIcon /> Open runs
                </Link>
              </DropdownMenuItem>
              {canManage && (
                <>
                  <DropdownMenuItem onSelect={() => trigger(a)}>
                    <WorkflowIcon /> Run now
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onEdit}>
                    <PencilIcon /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setDeleteOpen(true)} className="text-danger data-[highlighted]:text-danger">
                    <Trash2Icon /> Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-[13px] sm:grid-cols-4">
        <Stat label="Next run">
          {a.enabled && a.next_run_at ? (
            <Tooltip content={`${formatInZone(new Date(a.next_run_at), a.timezone)} (${a.timezone})`}>
              <span tabIndex={0} className="relative z-10 outline-none">
                <RelativeTime value={a.next_run_at} />
              </span>
            </Tooltip>
          ) : (
            <span className="text-fg-subtle">{a.enabled ? "Calculating…" : "Not scheduled"}</span>
          )}
        </Stat>
        <Stat label="Last run">
          {a.last_run_at ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <RelativeTime value={a.last_run_at} />
              {last && (
                <Badge tone={last.tone}>
                  <LiveDot tone={last.tone} live={Boolean(last.live)} />
                  {last.label}
                </Badge>
              )}
            </span>
          ) : (
            <span className="text-fg-subtle">Never</span>
          )}
        </Stat>
        <Stat label="Scheduled runs">
          <span className="tabular-nums">
            {a.run_count}
            {a.max_runs ? <span className="text-fg-subtle"> / {a.max_runs}</span> : null}
          </span>
        </Stat>
        <Stat label="Failures in a row">
          <span className={cn("tabular-nums", a.consecutive_failures > 0 && "text-danger")}>
            {a.consecutive_failures}
            {policy.pause_on_failure && <span className="text-fg-subtle"> / {policy.max_consecutive_failures}</span>}
          </span>
        </Stat>
      </dl>

      {reason && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/[0.06] px-3 py-2 text-xs leading-relaxed text-fg-muted">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
          <span>
            <span className="font-medium text-fg">{reason.label}.</span> {reason.description}
          </span>
        </p>
      )}

      <DeleteAutomationDialog automation={a} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </Card>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-2xs uppercase tracking-wider text-fg-subtle">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}

function EmptyAutomations({ canManage, onCreate }: { canManage: boolean; onCreate: (draft?: BuilderDraft) => void }) {
  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden">
        <EmptyState
          size="lg"
          visual={<EmptyOrbit />}
          title="Turn repetitive work into autonomous runs."
          description="Pick a schedule and a goal. On every run AgentOS creates a task and carries it out — asking for approval where it should, verifying what it did, and telling you when something fails."
          action={
            canManage ? (
              <Button variant="primary" onClick={() => onCreate()}>
                <PlusIcon aria-hidden /> New automation
              </Button>
            ) : (
              <p className="text-xs text-fg-subtle">Ask an admin for permission to manage automations.</p>
            )
          }
        />
      </Card>
      {canManage && (
        <section aria-labelledby="automation-templates" className="flex flex-col gap-3">
          <h2 id="automation-templates" className="text-sm font-semibold tracking-tight text-fg">
            Start from an idea
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {TEMPLATES.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => onCreate(t)}
                className="group flex flex-col gap-2 rounded-xl border border-line bg-surface-1 p-4 text-left outline-none transition-colors hover:border-line-strong hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <span className="flex items-center gap-2 text-xs text-fg-subtle">
                  <CalendarClockIcon className="size-3.5" aria-hidden /> {t.description}
                </span>
                <span className="text-[13px] font-medium text-fg">{t.name}</span>
                <span className="line-clamp-2 text-xs leading-relaxed text-fg-muted">{t.goal}</span>
                <span className="mt-auto inline-flex items-center gap-1 pt-1 text-xs font-medium text-accent opacity-80 group-hover:opacity-100">
                  Use this <ArrowRightIcon className="size-3.5" aria-hidden />
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Empty-state visual: a quiet orbit with evenly spaced run markers. */
function EmptyOrbit() {
  return (
    <svg viewBox="0 0 160 160" className="size-36" aria-hidden>
      <circle cx="80" cy="80" r="56" fill="none" className="stroke-white/[0.08]" strokeDasharray="3 5" />
      <circle cx="80" cy="80" r="34" fill="none" className="stroke-white/[0.06]" />
      <g className="origin-center motion-safe:animate-[spin_24s_linear_infinite]" style={{ transformOrigin: "80px 80px" }}>
        {Array.from({ length: 7 }).map((_, i) => {
          const a = (i / 7) * Math.PI * 2 - Math.PI / 2;
          return (
            <circle
              key={i}
              cx={80 + Math.cos(a) * 56}
              cy={80 + Math.sin(a) * 56}
              r={i === 0 ? 4 : 2.5}
              className={i === 0 ? "fill-accent" : "fill-accent/40"}
            />
          );
        })}
      </g>
      <circle cx="80" cy="80" r="10" className="fill-accent/15" />
      <circle cx="80" cy="80" r="3" className="fill-accent" />
    </svg>
  );
}

