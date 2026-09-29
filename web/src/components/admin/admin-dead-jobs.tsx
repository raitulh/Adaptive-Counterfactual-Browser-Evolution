"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListRestartIcon, RotateCcwIcon } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RelativeTime } from "@/components/ui/data-display";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState, InlineError } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { adminApi } from "@/lib/api";
import { qk } from "@/lib/query/keys";
import { useAdminOrganizations } from "./admin-organizations";
import { AdminSection } from "./admin-shell";

interface DeadJob {
  id: string;
  queue: string;
  job_type: string;
  attempts: number;
  last_error: string;
  finished_at: string | null;
  tenant_id: string | null;
}

function toDeadJob(raw: Record<string, unknown>): DeadJob {
  return {
    id: String(raw.id ?? ""),
    queue: String(raw.queue ?? ""),
    job_type: String(raw.job_type ?? ""),
    attempts: typeof raw.attempts === "number" ? raw.attempts : 0,
    last_error: typeof raw.last_error === "string" ? raw.last_error : "",
    finished_at: typeof raw.finished_at === "string" ? raw.finished_at : null,
    tenant_id: typeof raw.tenant_id === "string" ? raw.tenant_id : null,
  };
}

export function AdminDeadJobs() {
  const queryClient = useQueryClient();
  const jobs = useQuery({
    queryKey: qk.admin.deadJobs,
    queryFn: ({ signal }) => adminApi.deadJobs({ limit: 200 }, { signal }),
    select: (rows) => rows.map(toDeadJob),
  });
  const orgs = useAdminOrganizations();
  const orgName = React.useMemo(() => new Map((orgs.data ?? []).map((o) => [o.id, o.name])), [orgs.data]);
  const [target, setTarget] = React.useState<DeadJob | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const retry = useMutation({
    mutationFn: (job: DeadJob) => adminApi.retryJob(job.id),
    onSuccess: (_d, job) => {
      toast.success(`${job.job_type} re-queued`, {
        description: "It runs again on the next available worker for its queue.",
      });
      setTarget(null);
      void queryClient.invalidateQueries({ queryKey: qk.admin.deadJobs });
      void queryClient.invalidateQueries({ queryKey: qk.admin.system });
    },
  });

  const columns: Column<DeadJob>[] = [
    {
      id: "job",
      header: "Job",
      cell: (j) => (
        <div className="min-w-0">
          <div className="font-mono text-[12.5px] text-fg">{j.job_type}</div>
          <div className="text-2xs text-fg-subtle">
            queue <span className="font-mono">{j.queue}</span> · {j.attempts} attempt{j.attempts === 1 ? "" : "s"}
          </div>
        </div>
      ),
    },
    {
      id: "error",
      header: "Last error",
      cell: (j) => (
        <button
          type="button"
          onClick={() => setExpanded(expanded === j.id ? null : j.id)}
          aria-expanded={expanded === j.id}
          className="max-w-md text-left font-mono text-2xs text-danger/90 outline-none hover:text-danger focus-visible:underline"
        >
          <span className={expanded === j.id ? "break-words whitespace-pre-wrap" : "line-clamp-2 break-all"}>
            {j.last_error || "No error recorded"}
          </span>
        </button>
      ),
    },
    {
      id: "org",
      header: "Organization",
      hideBelow: "lg",
      cell: (j) => (
        <span className="text-xs text-fg-muted">
          {j.tenant_id ? (orgName.get(j.tenant_id) ?? `${j.tenant_id.slice(0, 8)}…`) : "Platform"}
        </span>
      ),
    },
    {
      id: "when",
      header: "Failed",
      hideBelow: "md",
      cell: (j) => <RelativeTime value={j.finished_at} className="text-xs text-fg-muted" />,
    },
    {
      id: "retry",
      header: <span className="sr-only">Actions</span>,
      className: "text-right",
      cell: (j) => (
        <Button variant="outline" size="xs" onClick={() => setTarget(j)}>
          <RotateCcwIcon /> Retry
        </Button>
      ),
    },
  ];

  return (
    <AdminSection
      title="Dead-lettered jobs"
      description="Background jobs that exhausted their retries. Fix the cause first — retrying resets the attempt counter and runs the job again."
    >
      <DataTable
        caption="Dead-lettered jobs"
        columns={columns}
        rows={jobs.data ?? []}
        rowKey={(j) => j.id}
        isLoading={jobs.isLoading}
        error={jobs.error}
        onRetry={() => void jobs.refetch()}
        empty={
          <EmptyState
            size="sm"
            icon={<ListRestartIcon />}
            title="No dead-lettered jobs"
            description="Every background job either succeeded or is still retrying."
          />
        }
      />
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => {
          if (!o) {
            setTarget(null);
            retry.reset();
          }
        }}
        title={`Retry ${target?.job_type}?`}
        description="The job is moved back to pending with a fresh attempt budget. Jobs are idempotent by design, but make sure the underlying problem is fixed."
        confirmLabel="Retry job"
        loading={retry.isPending}
        onConfirm={() => {
          if (target) retry.mutate(target);
        }}
      >
        {retry.error ? <InlineError error={retry.error} /> : null}
      </ConfirmDialog>
    </AdminSection>
  );
}
