"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  agentsApi,
  type AgentCreate,
  type AgentOut,
  type AgentUpdate,
  type AgentVersionIn,
  type Page,
} from "@/lib/api";
import { qk } from "@/lib/query/keys";
import { useCursorQuery } from "@/lib/query/pagination";

/** Separate from `qk.agents.list` (other features may cache a plain list there); invalidated by the same prefix. */
const agentsInfiniteKey = [...qk.agents.list, "infinite"] as const;

export function useAgentsList(pageSize = 24) {
  return useCursorQuery<AgentOut>({
    queryKey: agentsInfiniteKey,
    fetchPage: (cursor, signal) => agentsApi.list({ cursor, limit: pageSize }, { signal }) as Promise<Page<AgentOut>>,
  });
}

export function useAgent(agentId: string, enabled = true) {
  return useQuery({
    queryKey: qk.agents.detail(agentId),
    queryFn: ({ signal }) => agentsApi.get(agentId, { signal }),
    enabled,
  });
}

export function useAgentVersions(agentId: string, enabled = true) {
  return useQuery({
    queryKey: qk.agents.versions(agentId),
    queryFn: ({ signal }) => agentsApi.versions(agentId, { signal }),
    enabled,
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AgentCreate) => agentsApi.create(body),
    onSuccess: (agent) => {
      qc.setQueryData(qk.agents.detail(agent.id), agent);
      void qc.invalidateQueries({ queryKey: qk.agents.list });
    },
  });
}

export function useCreateAgentVersion(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AgentVersionIn) => agentsApi.createVersion(agentId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.agents.detail(agentId) });
      void qc.invalidateQueries({ queryKey: qk.agents.versions(agentId) });
      void qc.invalidateQueries({ queryKey: qk.agents.list });
    },
  });
}

export function useUpdateAgent(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AgentUpdate) => agentsApi.update(agentId, body),
    onSuccess: (agent) => {
      qc.setQueryData(qk.agents.detail(agentId), agent);
      void qc.invalidateQueries({ queryKey: qk.agents.list });
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => agentsApi.remove(agentId),
    onSuccess: (_data, agentId) => {
      qc.removeQueries({ queryKey: qk.agents.detail(agentId) });
      qc.removeQueries({ queryKey: qk.agents.versions(agentId) });
      void qc.invalidateQueries({ queryKey: qk.agents.list });
    },
  });
}
