"use client";

import { AlertTriangleIcon, ArrowLeftIcon, PencilIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  IdChip,
  JsonViewer,
  KeyValue,
  LiveDot,
  MetricCard,
  PageContainer,
  PageHeader,
  RelativeTime,
  Skeleton,
} from "@/components/ui";
import type { AutomationOut } from "@/lib/api";
import { usePermissions } from "@/lib/auth/hooks";
import { dateTime, number } from "@/lib/format";
import { toneClasses } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { DeleteAutomationDialog, EnabledSwitch, RunNowButton } from "./automation-actions";
import { AutomationBuilderDialog } from "./automation-builder";
import {
  disabledReasonMeta,
  formatSeconds,
  presentAutomationState,
  presentLastStatus,
  readPolicy,
  readRetryPolicy,
  readTemplate,
} from "./automation-status";
import { useAgentOptions, useAutomation } from "./hooks";
import { RunsHistory } from "./runs-history";
import { cronToWords, describeSchedule, formatInZone } from "./schedule";
import { RunTimeline, ScheduleSentence } from "./schedule-preview";

export function AutomationDetail({ automationId }: { automationId: string }) {
  const query = useAutomation(automationId);
  return (
    <PageContainer width="wide">
      <Link href="/app/automations" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-fg-muted hover:text-fg">
        <ArrowLeftIcon className="size-4" aria-hidden /> Automations
      </Link>
      {query.isPending ? (
        <DetailSkeleton />
      ) : query.isError ? (
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      ) : (
        <DetailBody automation={query.data} />
      )}
    </PageContainer>
  );
}

function DetailBody({ automation: a }: { automation: AutomationOut }) {
  const router = useRouter();
  const { can } = usePermissions();
  const developerMode = useUiStore((s) => s.developerMode);
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const state = presentAutomationState(a);
  const template = readTemplate(a.task_template);
  const retry = readRetryPolicy(a.retry_policy);
  const policy = readPolicy(a.policy);
  const last = presentLastStatus(a.last_status);
  const agents = useAgentOptions(Boolean(template.agent_id));
  const agentName = template.agent_id ? (agents.data?.items.find((x) => x.id === template.agent_id)?.name ?? null) : null;
  const reason = a.disabled_reason ? disabledReasonMeta[a.disabled_reason] : null;
  const canManage = can("automations:manage");
  const cronWords = cronToWords(a.cron_expression);

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2 normal-case tracking-normal">
            <Badge tone={state.tone} size="md">
              {state.label}
            </Badge>
          </span>
        }
        title={a.name}
        description={
          <>
            {describeSchedule(a.cron_expression)} · {a.timezone.replace(/_/g, " ")}{" "}
            <code className="ml-1 rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-xs text-fg-subtle">{a.cron_expression}</code>
          </>
        }
        actions={
          <>
            <span className="flex items-center gap-2 rounded-lg border border-line bg-surface-1 px-3 py-1.5">
              <span className="text-[13px] text-fg-muted">
                {a.enabled ? "On" : "Off"}
              </span>
              <EnabledSwitch automation={a} />
            </span>
            <RunNowButton automation={a} variant="primary" size="md" />
            {canManage && (
              <>
                <Button variant="secondary" onClick={() => setEditOpen(true)}>
                  <PencilIcon aria-hidden /> Edit
                </Button>
                <Button variant="danger-outline" size="icon" aria-label="Delete automation" onClick={() => setDeleteOpen(true)}>
                  <Trash2Icon />
                </Button>
              </>
            )}
          </>
        }
      />

      {reason && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-warning/25 bg-warning/[0.06] px-4 py-3" role="status">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="text-[13px] leading-relaxed">
            <p className="font-medium text-fg">{reason.label}</p>
            <p className="text-fg-muted">{reason.description}</p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <MetricCard
              label="Next run"
              value={a.enabled && a.next_run_at ? <RelativeTime value={a.next_run_at} className="text-xl" /> : <span className="text-xl text-fg-subtle">—</span>}
              hint={a.enabled && a.next_run_at ? formatInZone(new Date(a.next_run_at), a.timezone) : a.enabled ? "Calculating…" : "Not scheduled while off"}
            />
            <MetricCard
              label="Last run"
              value={a.last_run_at ? <RelativeTime value={a.last_run_at} className="text-xl" /> : <span className="text-xl text-fg-subtle">Never</span>}
              hint={
                last ? (
                  <span className={cn("inline-flex items-center gap-1.5", toneClasses[last.tone].text)}>
                    <LiveDot tone={last.tone} live={Boolean(last.live)} /> {last.label}
                  </span>
                ) : (
                  "No runs yet"
                )
              }
            />
            <MetricCard
              label="Scheduled runs"
              value={
                <span className="text-xl">
                  {number(a.run_count)}
                  {a.max_runs ? <span className="text-fg-subtle"> / {number(a.max_runs)}</span> : null}
                </span>
              }
              hint={a.max_runs ? "Stops at the limit" : "No limit · manual runs not counted"}
            />
            <MetricCard
              label="Failures in a row"
              value={<span className={cn("text-xl", a.consecutive_failures > 0 && "text-danger")}>{a.consecutive_failures}</span>}
              hint={policy.pause_on_failure ? `Pauses at ${policy.max_consecutive_failures}` : "Never pauses automatically"}
            />
          </div>

          <RunsHistory automationId={a.id} timezone={a.timezone} />
        </div>

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Automation settings">
          <Card className="p-5">
            <h2 className="mb-4 text-2xs font-medium uppercase tracking-wider text-fg-subtle">What happens</h2>
            <ScheduleSentence cron={a.cron_expression} timezone={a.timezone} goal={template.goal} agentName={agentName} />
          </Card>
          <Card className="p-5">
            <h2 className="mb-4 text-2xs font-medium uppercase tracking-wider text-fg-subtle">Upcoming</h2>
            <RunTimeline cron={a.cron_expression} timezone={a.timezone} paused={!a.enabled} />
            {a.enabled && a.next_run_at && (
              <p className="mt-3 text-2xs text-fg-subtle">
                Scheduler&apos;s next run: <span className="text-fg-muted">{dateTime(a.next_run_at)}</span> (your time)
              </p>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="mb-4 text-2xs font-medium uppercase tracking-wider text-fg-subtle">Task template</h2>
            <p className="whitespace-pre-line text-[13px] leading-relaxed text-fg">{template.goal}</p>
            {template.context && (
              <p className="mt-3 whitespace-pre-line border-l-2 border-line-strong pl-3 text-xs leading-relaxed text-fg-muted">{template.context}</p>
            )}
            <KeyValue
              className="mt-4"
              items={[
                ["Agent", agentName ?? (template.agent_id ? <IdChip id={template.agent_id} label="agent" /> : "Default agent")],
                ["Priority", String(template.priority)],
                ["Time limit", template.max_duration_seconds ? formatSeconds(template.max_duration_seconds) : "Default"],
              ]}
            />
          </Card>
          <Card className="p-5">
            <h2 className="mb-4 text-2xs font-medium uppercase tracking-wider text-fg-subtle">Schedule & policies</h2>
            <KeyValue
              items={[
                ["Cron", <code key="c" className="font-mono text-xs">{a.cron_expression}</code>],
                ...(cronWords ? ([["In words", cronWords]] as [string, React.ReactNode][]) : []),
                ["Time zone", a.timezone],
                ["Max runs", a.max_runs ? number(a.max_runs) : "No limit"],
                ["Retries", `${retry.max_attempts} ${retry.max_attempts === 1 ? "attempt" : "attempts"}, ${formatSeconds(retry.backoff_seconds)} backoff (doubling)`],
                ["On failure", policy.pause_on_failure ? `Pause after ${policy.max_consecutive_failures} in a row` : "Keep running"],
                ["Created", dateTime(a.created_at)],
                ["Updated", <RelativeTime key="u" value={a.updated_at} />],
              ]}
            />
          </Card>
          {developerMode && (
            <Card className="flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-2xs font-medium uppercase tracking-wider text-fg-subtle">Developer</h2>
                <IdChip id={a.id} label="automation" />
              </div>
              <JsonViewer value={a} />
            </Card>
          )}
        </aside>
      </div>

      <AutomationBuilderDialog open={editOpen} onOpenChange={setEditOpen} automation={a} />
      <DeleteAutomationDialog automation={a} open={deleteOpen} onOpenChange={setDeleteOpen} onDeleted={() => router.push("/app/automations")} />
    </>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading automation" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 pb-2">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-52 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
