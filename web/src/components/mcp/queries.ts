"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { mcpApi, type McpServerCreate, type McpServerOut, type McpToolOut, type McpToolUpdate } from "@/lib/api";
import { qk } from "@/lib/query/keys";

export function useMcpServers() {
  return useQuery({ queryKey: qk.mcp.servers, queryFn: ({ signal }) => mcpApi.servers({ signal }) });
}

export function useMcpServer(serverId: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: qk.mcp.server(serverId),
    queryFn: ({ signal }) => mcpApi.server(serverId, { signal }),
    initialData: () => qc.getQueryData<McpServerOut[]>(qk.mcp.servers)?.find((s) => s.id === serverId),
    initialDataUpdatedAt: () => qc.getQueryState(qk.mcp.servers)?.dataUpdatedAt,
  });
}

export function useMcpTools(serverId: string, enabled = true) {
  return useQuery({
    queryKey: qk.mcp.tools(serverId),
    queryFn: ({ signal }) => mcpApi.tools(serverId, { signal }),
    enabled,
  });
}

/** Tool lists for several servers at once (server list summaries). */
export function useMcpToolsForServers(serverIds: string[]) {
  return useQueries({
    queries: serverIds.map((id) => ({
      queryKey: qk.mcp.tools(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => mcpApi.tools(id, { signal }),
      staleTime: 30_000,
    })),
  });
}

function useServerWrite<TVars>(fn: (vars: TVars) => Promise<McpServerOut>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (server) => {
      qc.setQueryData(qk.mcp.server(server.id), server);
      qc.setQueryData<McpServerOut[]>(qk.mcp.servers, (list) => list?.map((s) => (s.id === server.id ? server : s)));
      void qc.invalidateQueries({ queryKey: qk.mcp.servers });
      void qc.invalidateQueries({ queryKey: qk.mcp.tools(server.id) });
      void qc.invalidateQueries({ queryKey: qk.tools.list });
    },
  });
}

export function useRegisterMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { body: McpServerCreate; idempotencyKey: string }) =>
      mcpApi.register(vars.body, vars.idempotencyKey),
    onSuccess: (server) => {
      qc.setQueryData(qk.mcp.server(server.id), server);
      void qc.invalidateQueries({ queryKey: qk.mcp.servers });
    },
  });
}

export function useApproveMcpServer() {
  return useServerWrite((serverId: string) => mcpApi.approve(serverId));
}

export function useDisableMcpServer() {
  return useServerWrite((serverId: string) => mcpApi.disable(serverId));
}

export function useDeleteMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (serverId: string) => mcpApi.remove(serverId),
    onSuccess: (_d, serverId) => {
      qc.setQueryData<McpServerOut[]>(qk.mcp.servers, (list) => list?.filter((s) => s.id !== serverId));
      qc.removeQueries({ queryKey: qk.mcp.server(serverId) });
      qc.removeQueries({ queryKey: qk.mcp.tools(serverId) });
      void qc.invalidateQueries({ queryKey: qk.mcp.servers });
      void qc.invalidateQueries({ queryKey: qk.tools.list });
    },
  });
}

export function useSyncMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (serverId: string) => mcpApi.sync(serverId),
    onSuccess: (result) => {
      qc.setQueryData(qk.mcp.server(result.server.id), result.server);
      if (result.tools) qc.setQueryData(qk.mcp.tools(result.server.id), result.tools);
      void qc.invalidateQueries({ queryKey: qk.mcp.servers });
      void qc.invalidateQueries({ queryKey: qk.tools.list });
    },
    // A failed sync records last_error / status on the server: refresh it.
    onError: (_err, serverId) => {
      void qc.invalidateQueries({ queryKey: qk.mcp.server(serverId) });
      void qc.invalidateQueries({ queryKey: qk.mcp.servers });
    },
  });
}

export function useUpdateMcpTool(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { toolId: string; body: McpToolUpdate }) => mcpApi.updateTool(vars.toolId, vars.body),
    onSuccess: (tool) => {
      qc.setQueryData<McpToolOut[]>(qk.mcp.tools(serverId), (list) => list?.map((t) => (t.id === tool.id ? tool : t)));
      void qc.invalidateQueries({ queryKey: qk.mcp.tools(serverId) });
      void qc.invalidateQueries({ queryKey: qk.tools.list });
    },
  });
}
