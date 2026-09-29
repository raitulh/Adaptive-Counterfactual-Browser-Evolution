"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLinkIcon, SearchCodeIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress, Skeleton } from "@/components/ui/controls";
import { IdChip, JsonViewer, KeyValue } from "@/components/ui/data-display";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { adminApi } from "@/lib/api";
import { dateTime, duration } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { useUiStore } from "@/stores/ui";
import { isUuid } from "@/components/activity/audit-meta";
import { AdminSection } from "./admin-shell";

export function AdminTaskLookup() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const developerMode = useUiStore((s) => s.developerMode);
  const id = params.get("id")?.trim().toLowerCase() ?? "";
  const valid = isUuid(id);
  const [draft, setDraft] = React.useState(id);
  const [error, setError] = React.useState<string | null>(null);
  const task = useQuery({
    queryKey: qk.admin.task(id),
    queryFn: ({ signal }) => adminApi.task(id, { signal }),
    enabled: valid,
    retry: false,
    staleTime: 15_000,
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = draft.trim().toLowerCase();
    if (!isUuid(v)) {
      setError("Enter a full task ID (UUID).");
      return;
    }
    setError(null);
    router.replace(`${pathname}?id=${encodeURIComponent(v)}`, { scroll: false });
  };

  const t = task.data;
  return (
    <AdminSection
      title="Task lookup"
      description="Inspect any task on the platform by ID, for support and incident response. Every lookup is written to the audit log."
    >
      <form onSubmit={submit} className="flex max-w-2xl flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden
          />
          <Input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            placeholder="Task ID, e.g. 01a0eb8c-…"
            className="pl-8 font-mono text-xs"
            aria-label="Task ID"
            aria-invalid={error ? true : undefined}
          />
        </div>
        <Button type="submit" variant="primary">
          Look up
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {!valid ? (
        <EmptyState
          size="sm"
          icon={<SearchCodeIcon />}
          title="Look up a task"
          description="Paste a task ID from a support request, an audit entry or a log line."
          className="rounded-xl border border-line bg-surface-1"
        />
      ) : task.error ? (
        <div className="rounded-xl border border-line bg-surface-1">
          <ErrorState error={task.error} onRetry={() => void task.refetch()} />
        </div>
      ) : !t ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <div className="grid gap-5 rounded-xl border border-line bg-surface-1 p-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge kind="task" value={t.status} size="md" />
              <IdChip id={t.task_id} />
            </div>
            <p className="text-[15px] leading-relaxed text-fg">{t.goal}</p>
            <div className="flex items-center gap-3">
              <Progress value={Math.round(t.progress * 100)} className="max-w-xs" label="Task progress" />
              <span className="font-mono text-xs text-fg-muted">{Math.round(t.progress * 100)}% of steps</span>
            </div>
            {(t.failure_code || t.failure_message) && (
              <div className="rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2">
                {t.failure_code && <div className="font-mono text-xs text-danger">{t.failure_code}</div>}
                {t.failure_message && <p className="mt-0.5 text-[13px] text-fg-muted">{t.failure_message}</p>}
              </div>
            )}
            {t.pending_questions && t.pending_questions.length > 0 && (
              <div>
                <div className="mb-1 text-2xs tracking-wider text-fg-subtle uppercase">Waiting for input</div>
                <ul className="list-inside list-disc text-[13px] text-fg-muted">
                  {t.pending_questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
            {t.result_summary && developerMode && <JsonViewer value={t.result_summary} />}
          </div>
          <div className="flex flex-col gap-4">
            <KeyValue
              items={[
                ["Created", dateTime(t.created_at)],
                ["Started", dateTime(t.started_at)],
                ["Completed", dateTime(t.completed_at)],
                ["Duration", t.started_at ? duration(t.started_at, t.completed_at) : "—"],
                ["Plan version", String(t.plan_version)],
                ["Model calls", String(t.model_calls)],
                ["Tool calls", String(t.tool_calls)],
                ["Priority", String(t.priority)],
                ...(t.agent_id
                  ? ([["Agent", <IdChip key="a" id={t.agent_id} />]] as Array<[React.ReactNode, React.ReactNode]>)
                  : []),
              ]}
            />
            <Button asChild variant="outline" size="sm">
              <Link href={`/app/tasks/${t.task_id}`}>
                Open task view <ExternalLinkIcon />
              </Link>
            </Button>
            <p className="text-2xs text-fg-subtle">
              The task view only works when the task belongs to your active organization.
            </p>
          </div>
        </div>
      )}
    </AdminSection>
  );
}
