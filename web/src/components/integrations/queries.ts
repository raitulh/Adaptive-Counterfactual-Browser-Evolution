"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { integrationsApi, type ConnectionOut } from "@/lib/api";
import { qk } from "@/lib/query/keys";
import type { GoogleCapabilityId } from "./google-capabilities";

export function useConnections(enabled = true) {
  return useQuery({
    queryKey: qk.integrations.list,
    queryFn: ({ signal }) => integrationsApi.list({ signal }),
    enabled,
  });
}

/** The user's Google connection that is not disconnected (most recent first), if any. */
export function activeGoogleConnection(connections: readonly ConnectionOut[] | undefined): ConnectionOut | undefined {
  return connections?.find((c) => c.provider === "google" && c.status !== "disconnected");
}

/**
 * Requests an authorization URL from the backend and navigates there. OAuth itself (state, PKCE,
 * token exchange) happens entirely in the backend; Google returns to the backend callback, which
 * redirects back to /app/integrations?status=….
 */
export function useConnectGoogle() {
  return useMutation({
    mutationFn: (vars: { capabilities: GoogleCapabilityId[]; loginHint?: string | null }) =>
      integrationsApi.connectGoogle({ capabilities: vars.capabilities, login_hint: vars.loginHint ?? null }),
    onSuccess: (res) => {
      window.location.assign(res.authorization_url);
    },
  });
}

function replaceConnection(list: ConnectionOut[] | undefined, next: ConnectionOut): ConnectionOut[] | undefined {
  if (!list) return list;
  return list.map((c) => (c.id === next.id ? next : c));
}

export function useCheckConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) => integrationsApi.check(connectionId),
    onSuccess: (conn) => {
      qc.setQueryData<ConnectionOut[]>(qk.integrations.list, (list) => replaceConnection(list, conn));
      void qc.invalidateQueries({ queryKey: qk.integrations.all });
    },
  });
}

export function useDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) => integrationsApi.disconnect(connectionId),
    onSuccess: (conn) => {
      qc.setQueryData<ConnectionOut[]>(qk.integrations.list, (list) => replaceConnection(list, conn));
      void qc.invalidateQueries({ queryKey: qk.integrations.all });
      void qc.invalidateQueries({ queryKey: qk.tools.all });
    },
  });
}
