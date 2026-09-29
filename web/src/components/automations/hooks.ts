"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { track } from "@/lib/analytics";
import {
  agentsApi,
  automationsApi,
  type AutomationCreate,
  type AutomationOut,
  type AutomationRunOut,
  type AutomationUpdate,
} from "@/lib/api";
import { qk } from "@/lib/query/keys";
import { useCursorQuery } from "@/lib/query/pagination";
import { presentRun } from "./automation-status";

const OPEN_POLL_MS = 3_000;

export function useAutomations() {
  return useCursorQuery<AutomationOut>({
    queryKey: qk.automations.list,
    fetchPage: (cursor, signal) => automationsApi.list({ cursor, limit: 30 }, { signal }),
    // A run in flight changes last_status/next_run_at soon; otherwise rely on focus refetches.
    refetchInterval: (items) => (items.some((a) => a.last_status === "created") ? 10_000 : false),
  });
}

export function useAutomation(id: string) {
  return useQuery({
    queryKey: qk.automations.detail(id),
    queryFn: ({ signal }) => automationsApi.get(id, { signal }),
    refetchInterval: (q) => (q.state.data?.last_status === "created" ? OPEN_POLL_MS : false),
  });
}

export function useAutomationRuns(id: string) {
  return useCursorQuery<AutomationRunOut>({
    queryKey: qk.automations.runs(id),
    fetchPage: (cursor, signal) => automationsApi.runs(id, { cursor, limit: 20 }, { signal }),
    refetchInterval: (runs) => (runs.some((r) => presentRun(r).open) ? OPEN_POLL_MS : false),
  });
}

/** Agents for the template picker (a separate key from the Agents page's own list). */
export function useAgentOptions(enabled: boolean) {
  return useQuery({
    queryKey: [...qk.agents.list, "picker"],
    queryFn: ({ signal }) => agentsApi.list({ limit: 100 }, { signal }),
    enabled,
    staleTime: 60_000,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return (automation?: AutomationOut) => {
    if (automation) qc.setQueryData(qk.automations.detail(automation.id), automation);
    void qc.invalidateQueries({ queryKey: qk.automations.list });
  };
}

export function useCreateAutomation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: AutomationCreate; idempotencyKey: string }) =>
      automationsApi.create(body, idempotencyKey),
    onSuccess: (a) => {
      track("automation_created", { enabled: a.enabled, has_max_runs: a.max_runs !== null });
      invalidate(a);
    },
  });
}

export function useUpdateAutomation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AutomationUpdate }) => automationsApi.update(id, body),
    onSuccess: (a) => invalidate(a),
  });
}

export function useDeleteAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => automationsApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.automations.list }),
  });
}

export function useRunNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => automationsApi.runNow(id),
    onSuccess: (run) => {
      track("automation_run_now", { run_status: run.status });
      void qc.invalidateQueries({ queryKey: qk.automations.runs(run.automation_id) });
      void qc.invalidateQueries({ queryKey: qk.automations.detail(run.automation_id) });
      void qc.invalidateQueries({ queryKey: qk.automations.list });
      void qc.invalidateQueries({ queryKey: qk.tasks.lists });
    },
  });
}
