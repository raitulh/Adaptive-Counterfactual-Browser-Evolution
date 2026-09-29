"use client";

import { BrainCircuitIcon, CloudOffIcon, FileTextIcon, GaugeIcon, PlugZapIcon, PowerOffIcon, RefreshCwIcon } from "lucide-react";
import * as React from "react";
import { Button, EmptyState, ErrorState, RequestId } from "@/components/ui";
import { normalizeError } from "@/lib/api/errors";

export type SearchTab = "web" | "documents" | "memory";

/** Seconds until `until` (ms epoch), ticking once a second; 0 when reached. */
function useCountdown(until: number | null): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (until === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

/**
 * Search failures are distinct situations with distinct next steps — never a generic crash:
 * not configured, turned off, no permission, rate-limited (ours or the provider's), provider down.
 */
export function SearchErrorPanel({
  error,
  tab,
  onSwitchTab,
  onRetry,
  failedAt,
}: {
  error: unknown;
  tab: SearchTab;
  onSwitchTab: (tab: SearchTab) => void;
  onRetry: () => void;
  /** When the error happened (ms epoch), to count down a Retry-After. */
  failedAt: number;
}) {
  const e = normalizeError(error);
  const retryIn = useCountdown(e.retryAfterSeconds ? failedAt + e.retryAfterSeconds * 1000 : null);
  const alternatives = (
    <>
      {tab !== "documents" && (
        <Button size="sm" variant="secondary" onClick={() => onSwitchTab("documents")}>
          <FileTextIcon aria-hidden /> Search your documents
        </Button>
      )}
      {tab !== "memory" && (
        <Button size="sm" variant="secondary" onClick={() => onSwitchTab("memory")}>
          <BrainCircuitIcon aria-hidden /> Search memory
        </Button>
      )}
    </>
  );
  const requestId = e.requestId ? (
    <span className="mt-3 block">
      <RequestId id={e.requestId} />
    </span>
  ) : null;

  if (e.code === "configuration_missing") {
    return (
      <EmptyState
        icon={<PlugZapIcon />}
        title="Web search isn't set up on this server"
        description={
          <>
            AgentOS needs a search provider to research the web, and none is configured here. Your documents and memory are
            still fully searchable.
            <span className="mt-3 block rounded-lg border border-line bg-surface-2 px-3 py-2 text-left text-xs text-fg-subtle">
              <span className="font-medium text-fg-muted">For administrators:</span> set{" "}
              <code className="font-mono text-fg-muted">SEARCH_PROVIDER</code> (<code className="font-mono">brave</code> or{" "}
              <code className="font-mono">google_cse</code>) and <code className="font-mono text-fg-muted">SEARCH_API_KEY</code> on the
              API server, then restart it.
            </span>
            {requestId}
          </>
        }
        action={alternatives}
      />
    );
  }

  if (e.code === "feature_disabled") {
    return (
      <EmptyState
        icon={<PowerOffIcon />}
        title="Web search is turned off for this organization"
        description={
          <>
            A platform administrator has disabled the web search feature for your organization. Documents and memory search are
            unaffected.
            {requestId}
          </>
        }
        action={alternatives}
      />
    );
  }

  if (e.kind === "rate_limited") {
    const provider = e.code === "integration_rate_limited";
    return (
      <EmptyState
        icon={<GaugeIcon />}
        title={provider ? "The search provider is limiting requests" : "You've reached the search limit"}
        description={
          <>
            {provider
              ? "The web search provider asked AgentOS to slow down. This usually clears within a minute."
              : "Searches are limited per minute to keep costs predictable."}{" "}
            <span aria-live="polite">{retryIn > 0 ? `You can search again in ${retryIn}s.` : "You can try again now."}</span>
            {requestId}
          </>
        }
        action={
          <>
            <Button size="sm" variant="secondary" onClick={onRetry} disabled={retryIn > 0}>
              <RefreshCwIcon aria-hidden /> {retryIn > 0 ? `Try again in ${retryIn}s` : "Try again"}
            </Button>
            {alternatives}
          </>
        }
      />
    );
  }

  if (e.code === "integration_timeout" || e.code === "integration_temporarily_unavailable" || (tab === "web" && e.kind === "unavailable")) {
    return (
      <EmptyState
        icon={<CloudOffIcon />}
        title="The search provider isn't responding"
        description={
          <>
            {e.userMessage} Nothing is wrong with your query; try again in a moment.
            {requestId}
          </>
        }
        action={
          <>
            <Button size="sm" variant="secondary" onClick={onRetry}>
              <RefreshCwIcon aria-hidden /> Try again
            </Button>
            {alternatives}
          </>
        }
      />
    );
  }

  if (e.kind === "validation") {
    return <EmptyState size="sm" icon={<CloudOffIcon />} title="That search couldn't run" description={e.userMessage} />;
  }

  // Permission denied (403 → PermissionDenied), network, server errors.
  return <ErrorState error={e} onRetry={onRetry} />;
}
