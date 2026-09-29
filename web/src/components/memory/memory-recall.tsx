"use client";

import { SearchXIcon } from "lucide-react";
import * as React from "react";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui";
import type { MemoryType } from "@/lib/api";
import { useMemorySearch } from "./hooks";
import { MemoryCard } from "./memory-card";
import { useNow } from "./memory-meters";
import { metaForType } from "./presentation";
import { queryTerms } from "../search/highlight";

export function MemoryRecallSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex flex-col gap-4 rounded-xl border border-line bg-surface-1 p-5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-4 w-4/5" />
          <div className="flex gap-6">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Hybrid recall (keyword + semantic + recency + importance) over the user's memories, ranked by
 * the backend. Used by Memory OS and by the Search page's Memory tab.
 */
export function MemoryRecallResults({
  query,
  memoryTypes,
  limit = 12,
  onResults,
  renderItem,
}: {
  query: string;
  memoryTypes?: MemoryType[] | null;
  limit?: number;
  onResults?: (count: number) => void;
  /** Wrap each result (e.g. to make it keyboard-navigable). */
  renderItem?: (node: React.ReactNode, index: number, id: string) => React.ReactNode;
}) {
  const request = React.useMemo(
    () => (query.trim() ? { query: query.trim(), limit, memory_types: memoryTypes?.length ? memoryTypes : null } : null),
    [query, limit, memoryTypes],
  );
  const search = useMemorySearch(request);
  const now = useNow();
  const terms = React.useMemo(() => queryTerms(query), [query]);
  const count = search.data?.results.length;

  React.useEffect(() => {
    if (count !== undefined) onResults?.(count);
  }, [count, onResults]);

  if (!request) return null;
  if (search.isPending) return <MemoryRecallSkeleton />;
  if (search.isError) return <ErrorState error={search.error} onRetry={() => void search.refetch()} compact />;

  const results = search.data.results;
  if (results.length === 0) {
    const scope = memoryTypes?.length === 1 ? ` in ${metaForType(memoryTypes[0]).section.toLowerCase()}` : "";
    return (
      <EmptyState
        size="sm"
        icon={<SearchXIcon />}
        title={`Nothing remembered about “${query.trim()}”${scope}`}
        description="AgentOS only recalls what it was told or learned during tasks. Try different words, or teach it with “Remember something”."
      />
    );
  }

  return (
    <ol className="flex flex-col gap-3" aria-label={`${results.length} recalled memories, best match first`}>
      {results.map((m, i) => {
        const card = <MemoryCard memory={m} now={now} terms={terms} />;
        return <li key={m.id}>{renderItem ? renderItem(card, i, m.id) : card}</li>;
      })}
    </ol>
  );
}
