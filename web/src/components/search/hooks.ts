"use client";

import { useQuery } from "@tanstack/react-query";
import { searchApi } from "@/lib/api";
import { normalizeError } from "@/lib/api/errors";
import { qk } from "@/lib/query/keys";

/**
 * Searches are reads (POST only because of the body), cached briefly so switching tabs doesn't
 * re-run them. Only plain network failures are retried: configuration, permission and rate-limit
 * errors are answers, and retrying the web provider would only burn the per-minute budget.
 */
const retry = (count: number, err: unknown) => count < 1 && normalizeError(err).kind === "network";

export const WEB_MAX_RESULTS = 10;
export const DOCUMENT_LIMIT = 15;

export function useWebSearch(query: string, enabled: boolean) {
  const body = { query, max_results: WEB_MAX_RESULTS };
  return useQuery({
    queryKey: qk.search.web(body),
    queryFn: ({ signal }) => searchApi.web(body, { signal }),
    enabled: enabled && query.length > 0,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry,
  });
}

export function useDocumentSearch(query: string, enabled: boolean) {
  const body = { query, limit: DOCUMENT_LIMIT };
  return useQuery({
    queryKey: qk.search.documents(body),
    queryFn: ({ signal }) => searchApi.documents(body, { signal }),
    enabled: enabled && query.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry,
  });
}
