"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getApi } from "@/lib/api";
import { queryKeys } from "@/lib/api/query-keys";
import type { ApiKey, EventOutcome, WebhookEndpoint } from "@/lib/schemas/dashboard";
import type {
  CreateApiKeyValues,
  CreateWebhookValues,
  ProjectSettingsValues,
} from "@/lib/schemas/forms";

export function useAuthSession() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => getApi().auth.me({ signal }),
    staleTime: 5 * 60_000,
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => getApi().auth.logout(),
    // Drop every cached response so the next account starts clean.
    onSettled: () => client.clear(),
  });
}

export function useOverview() {
  return useQuery({
    queryKey: queryKeys.overview,
    queryFn: ({ signal }) => getApi().dashboard.getOverview({ signal }),
  });
}

export function useRecentEvents(limit = 8) {
  return useQuery({
    queryKey: queryKeys.events(limit),
    queryFn: ({ signal }) => getApi().dashboard.listEvents({ limit }, { signal }),
  });
}

export function useSessions(outcome: EventOutcome | "all") {
  return useQuery({
    queryKey: queryKeys.sessions(outcome),
    queryFn: ({ signal }) =>
      getApi().dashboard.listSessions(outcome === "all" ? {} : { outcome }, { signal }),
    placeholderData: (previous) => previous,
  });
}

export function useRequestLogs(limit = 30) {
  return useQuery({
    queryKey: queryKeys.logs(limit),
    queryFn: ({ signal }) => getApi().dashboard.listRequestLogs({ limit }, { signal }),
  });
}

export function useApiKeys() {
  return useQuery({
    queryKey: queryKeys.apiKeys,
    queryFn: ({ signal }) => getApi().apiKeys.list({ signal }),
  });
}

export function useCreateApiKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (values: CreateApiKeyValues) => getApi().apiKeys.create(values),
    onSuccess: ({ secret: _secret, ...key }) => {
      // Cache only the masked record; the secret never enters the query cache.
      client.setQueryData<ApiKey[]>(queryKeys.apiKeys, (keys = []) => [key, ...keys]);
    },
  });
}

export function useRevokeApiKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getApi().apiKeys.revoke(id),
    onSuccess: (_result, id) => {
      client.setQueryData<ApiKey[]>(queryKeys.apiKeys, (keys = []) =>
        keys.filter((key) => key.id !== id),
      );
    },
  });
}

export function useWebhooks() {
  return useQuery({
    queryKey: queryKeys.webhooks,
    queryFn: ({ signal }) => getApi().webhooks.list({ signal }),
  });
}

export function useCreateWebhook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (values: CreateWebhookValues) => getApi().webhooks.create(values),
    onSuccess: ({ signingSecret: _secret, ...endpoint }) => {
      // Like API keys: the signing secret never enters the query cache.
      client.setQueryData<WebhookEndpoint[]>(queryKeys.webhooks, (list = []) => [
        endpoint,
        ...list,
      ]);
    },
  });
}

export function useRemoveWebhook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getApi().webhooks.remove(id),
    onSuccess: (_result, id) => {
      client.setQueryData<WebhookEndpoint[]>(queryKeys.webhooks, (list = []) =>
        list.filter((endpoint) => endpoint.id !== id),
      );
    },
  });
}

export function useProjectSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => getApi().settings.get({ signal }),
  });
}

export function useUpdateProjectSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (values: ProjectSettingsValues) => getApi().settings.update(values),
    onSuccess: (settings) => client.setQueryData(queryKeys.settings, settings),
  });
}
