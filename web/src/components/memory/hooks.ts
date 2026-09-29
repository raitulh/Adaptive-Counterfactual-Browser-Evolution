"use client";

import { useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { track } from "@/lib/analytics";
import {
  memoryApi,
  type ListMemoryQuery,
  type MemoryCreate,
  type MemoryOut,
  type MemorySearchRequest,
  type MemoryType,
  type Page,
} from "@/lib/api";
import { isApiError } from "@/lib/api/errors";
import { qk } from "@/lib/query/keys";
import { useCursorQuery } from "@/lib/query/pagination";

export type MemoryStatusFilter = NonNullable<ListMemoryQuery["status"]>;

export function useMemoryList(filter: { memory_type?: MemoryType | null; status?: MemoryStatusFilter | null }, enabled = true) {
  const query: ListMemoryQuery = {};
  if (filter.memory_type) query.memory_type = filter.memory_type;
  if (filter.status) query.status = filter.status;
  return useCursorQuery<MemoryOut>({
    queryKey: qk.memory.list(query),
    fetchPage: (cursor, signal) => memoryApi.list({ ...query, cursor, limit: 30 }, { signal }),
    enabled,
  });
}

export function useMemorySearch(request: MemorySearchRequest | null) {
  return useQuery({
    queryKey: qk.memory.search(request),
    queryFn: ({ signal }) => memoryApi.search(request!, { signal }),
    enabled: Boolean(request?.query.trim()),
    staleTime: 30_000,
    retry: (count, err) => (isApiError(err) ? err.isRetryable && count < 1 : count < 1),
  });
}

/** Replace one memory in every cached list page (the backend response is the truth). */
function replaceInLists(qc: ReturnType<typeof useQueryClient>, updated: MemoryOut) {
  qc.setQueriesData<InfiniteData<Page<MemoryOut>>>({ queryKey: ["memory", "list"] }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((p) => ({ ...p, items: p.items.map((m) => (m.id === updated.id ? updated : m)) })),
        }
      : data,
  );
}

export function useCreateMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: MemoryCreate; idempotencyKey: string }) => memoryApi.create(body, idempotencyKey),
    onSuccess: (memory) => {
      track("memory_created", { memory_type: memory.memory_type });
      void qc.invalidateQueries({ queryKey: qk.memory.all });
    },
  });
}

export function useVerifyMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => memoryApi.verify(id),
    onSuccess: (memory) => {
      replaceInLists(qc, memory);
      void qc.invalidateQueries({ queryKey: qk.memory.all });
    },
  });
}

export function useDeleteMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => memoryApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.memory.all }),
  });
}
