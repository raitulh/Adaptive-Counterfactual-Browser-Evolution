"use client";

import { useState } from "react";
import { DataTable, Td, Th, Tr } from "@/components/dashboard/data-table";
import { MockNotice } from "@/components/dashboard/mock-notice";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { OutcomeBadge, RiskBadge, outcomeLabel } from "@/components/ui/status-badge";
import { useSessions } from "@/hooks/use-dashboard-data";
import { toApiError } from "@/lib/api";
import type { EventOutcome } from "@/lib/schemas/dashboard";
import { cn } from "@/lib/utils/cn";
import { formatDuration, formatScore, formatUtcDateTime, maskId } from "@/lib/utils/format";

const FILTERS: readonly (EventOutcome | "all")[] = [
  "all",
  "verified",
  "step_up",
  "blocked",
  "expired",
];
const CHALLENGE_LABEL = {
  none: "None",
  press_hold: "Press & hold",
  single_step: "Single step",
} as const;

export function SessionsView() {
  const [filter, setFilter] = useState<EventOutcome | "all">("all");
  const sessions = useSessions(filter);

  return (
    <>
      <PageHeader
        title="Sessions"
        description="Every verification session, its decision and the score behind it."
      />
      <MockNotice />

      <div role="group" aria-label="Filter by outcome" className="flex flex-wrap gap-1.5">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              "h-8 rounded-lg border px-3 text-[13px] transition-colors",
              filter === value
                ? "border-border-bright bg-surface-overlay text-foreground"
                : "border-border text-muted hover:border-border-strong hover:text-foreground",
            )}
          >
            {value === "all" ? "All" : outcomeLabel(value)}
          </button>
        ))}
      </div>

      {sessions.isPending ? (
        <LoadingState rows={8} label="Loading sessions" />
      ) : sessions.isError ? (
        <ErrorState
          title="Couldn't load sessions"
          description={toApiError(sessions.error).message}
          onRetry={() => void sessions.refetch()}
        />
      ) : sessions.data.length === 0 ? (
        <EmptyState
          title="No sessions match this filter"
          description="Try another outcome, or widen the time range once live data is connected."
        />
      ) : (
        <DataTable label="Verification sessions">
          <thead>
            <tr>
              <Th>Session</Th>
              <Th>Outcome</Th>
              <Th>Risk</Th>
              <Th className="text-right">Score</Th>
              <Th>Challenge</Th>
              <Th>Origin</Th>
              <Th>Started</Th>
              <Th className="text-right">Duration</Th>
            </tr>
          </thead>
          <tbody className={cn(sessions.isPlaceholderData && "opacity-60")}>
            {sessions.data.map((session) => (
              <Tr key={session.id}>
                <Td className="font-mono text-xs text-foreground">{maskId(session.id)}</Td>
                <Td>
                  <OutcomeBadge outcome={session.outcome} />
                </Td>
                <Td>
                  <RiskBadge risk={session.risk} />
                </Td>
                <Td className="text-right font-mono tabular-nums">{formatScore(session.score)}</Td>
                <Td>{CHALLENGE_LABEL[session.challenge]}</Td>
                <Td>{session.origin}</Td>
                <Td className="font-mono text-xs">{formatUtcDateTime(session.startedAt)}</Td>
                <Td className="text-right font-mono text-xs tabular-nums">
                  {formatDuration(session.durationMs)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
