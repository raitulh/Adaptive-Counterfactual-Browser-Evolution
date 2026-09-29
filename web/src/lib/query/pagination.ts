"use client";

/**
 * Cursor (keyset) pagination. The backend returns `{items, next_cursor, has_more}`; we follow the
 * cursor as-is and never invent page numbers.
 */
import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Page } from "@/lib/api";

export interface CursorQueryOptions<T> {
  queryKey: QueryKey;
  fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<Page<T>>;
  enabled?: boolean;
  staleTime?: number;
  /** A fixed interval, or a function of the loaded items (e.g. poll only while something is processing). */
  refetchInterval?: number | false | ((items: T[]) => number | false);
}

export function useCursorQuery<T>({ queryKey, fetchPage, enabled = true, staleTime, refetchInterval }: CursorQueryOptions<T>) {
  const query = useInfiniteQuery({
    queryKey,
    enabled,
    staleTime,
    refetchInterval:
      typeof refetchInterval === "function"
        ? (q) => refetchInterval(q.state.data?.pages.flatMap((p) => p.items) ?? [])
        : refetchInterval,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => fetchPage(pageParam, signal),
    getNextPageParam: (last: Page<T>) => (last.has_more && last.next_cursor ? last.next_cursor : undefined),
  });
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  return { ...query, items };
}
