"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toolsApi, type ToolConnectRequest, type ToolRuleIn } from "@/lib/api";
import { qk } from "@/lib/query/keys";

/** Built-in + usable MCP tools with the caller's effective decision for each. */
export function useToolCatalog(enabled = true) {
  return useQuery({
    queryKey: qk.tools.list,
    queryFn: ({ signal }) => toolsApi.list({ signal }),
    staleTime: 60_000,
    enabled,
  });
}

export function useToolRules(enabled = true) {
  return useQuery({
    queryKey: qk.tools.policies,
    queryFn: ({ signal }) => toolsApi.policies({ signal }),
    enabled,
  });
}

export function useCreateToolRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ToolRuleIn) => toolsApi.createPolicy(body),
    // Rules change the effective decision reported for every tool in the catalogue.
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tools.all }),
  });
}

export function useDeleteToolRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ruleId: string) => toolsApi.deletePolicy(ruleId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tools.all }),
  });
}

/** Starts the provider OAuth flow for a tool and navigates to the backend authorization URL. */
export function useConnectToolProvider() {
  return useMutation({
    mutationFn: (body: ToolConnectRequest) => toolsApi.connect(body),
    onSuccess: (res) => {
      window.location.assign(res.authorization_url);
    },
  });
}
