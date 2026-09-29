"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  BlocksIcon,
  KeyRoundIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/controls";
import { CopyButton, IdChip, JsonViewer, KeyValue, RelativeTime } from "@/components/ui/data-display";
import { PageContainer } from "@/components/ui/page";
import { EmptyState, ErrorState } from "@/components/ui/states";
import type { McpServerOut, McpSyncResult, McpToolOut } from "@/lib/api";
import { usePermissions } from "@/lib/auth/hooks";
import { dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { ServerStatusBadge } from "./mcp-page";
import { countTools, reviewState, serverStatusMeta, toolsNeedingAttention } from "./mcp-review";
import { McpToolRow } from "./mcp-tool-row";
import { useMcpServer, useMcpTools } from "./queries";
import { canSync, lastSyncKey, ServerActionBar } from "./server-actions";
import { SyncResultPanel } from "./sync-result-panel";
import { ToolReviewDialog } from "./tool-review-dialog";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function useLastSync(serverId: string) {
  return useQuery<{ result: McpSyncResult; at: number } | null>({
    queryKey: lastSyncKey(serverId),
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
  });
}

function StatusBanner({ server }: { server: McpServerOut }) {
  if (server.status === "pending_review") {
    return (
      <div
        role="status"
        className="flex gap-3 rounded-xl border border-warning/30 bg-warning/[0.06] px-4 py-3 text-[13px]"
      >
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <p className="text-fg-muted">
          <span className="font-medium text-fg">Awaiting approval.</span> AgentOS has not contacted{" "}
          <span className="font-mono text-fg">{hostOf(server.url)}</span> yet. Approving re-checks the URL against the
          egress policy and allows syncing; every discovered tool still needs its own review.
        </p>
      </div>
    );
  }
  if (server.status === "error" || server.last_error) {
    return (
      <div
        role="alert"
        className="flex gap-3 rounded-xl border border-danger/30 bg-danger/[0.06] px-4 py-3 text-[13px]"
      >
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
        <div className="min-w-0 text-fg-muted">
          <p>
            <span className="font-medium text-fg">
              {server.status === "error" ? "The last sync failed." : "The last sync attempt failed."}
            </span>{" "}
            {server.status === "error"
              ? serverStatusMeta("error").description
              : "The previous tool list is kept; transient failures do not change the server status."}
          </p>
          {server.last_error && <p className="mt-1 font-mono text-2xs break-words text-danger">{server.last_error}</p>}
        </div>
      </div>
    );
  }
  if (server.status === "disabled") {
    return (
      <div
        role="status"
        className="flex gap-3 rounded-xl border border-line-strong bg-surface-2 px-4 py-3 text-[13px] text-fg-muted"
      >
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
        <p>
          <span className="font-medium text-fg">Disabled.</span> None of this server&apos;s tools are available to
          agents. Approve the server again to restore previously enabled tools.
        </p>
      </div>
    );
  }
  return null;
}

function AttentionBanner({
  tools,
  server,
  onReview,
}: {
  tools: McpToolOut[];
  server: McpServerOut;
  onReview: (t: McpToolOut) => void;
}) {
  const attention = toolsNeedingAttention(tools, server);
  if (attention.length === 0) return null;
  const changed = attention.filter((t) => reviewState(t, server) === "schema_changed");
  const fresh = attention.length - changed.length;
  const danger = changed.length > 0;
  return (
    <div
      role="alert"
      className={cn(
        "rounded-xl border px-4 py-3",
        danger ? "border-danger/35 bg-danger/[0.06]" : "border-warning/30 bg-warning/[0.06]",
      )}
    >
      <div className="flex gap-3 text-[13px]">
        <ShieldAlertIcon
          className={cn("mt-0.5 size-4 shrink-0", danger ? "text-danger" : "text-warning")}
          aria-hidden
        />
        <div className="min-w-0 flex-1 text-fg-muted">
          <p className="font-medium text-fg">
            {danger
              ? `${changed.length} ${changed.length === 1 ? "tool changed" : "tools changed"} since approval`
              : `${fresh} ${fresh === 1 ? "tool needs" : "tools need"} review`}
            {danger && fresh > 0 && <span className="font-normal text-fg-muted"> · {fresh} new to review</span>}
          </p>
          <p className="mt-0.5">
            {danger
              ? "Their name, description, schemas or hints no longer match what was approved, so they were disabled automatically. Re-approve each one only after checking the new definition."
              : "Newly discovered tools are stored disabled. Review each definition and set its permission level and risk before enabling it."}
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {attention.slice(0, 8).map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onReview(t)}
                  disabled={server.status !== "approved"}
                  className={cn(
                    "rounded-md border px-2 py-0.5 font-mono text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-60",
                    reviewState(t, server) === "schema_changed"
                      ? "border-danger/40 text-fg hover:bg-danger/10"
                      : "border-warning/40 text-fg hover:bg-warning/10",
                  )}
                >
                  {t.qualified_name}
                </button>
              </li>
            ))}
            {attention.length > 8 && <li className="text-xs text-fg-subtle">+{attention.length - 8} more below</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function ServerDetail({ serverId }: { serverId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const developerMode = useUiStore((s) => s.developerMode);
  const { can } = usePermissions();
  const canManage = can("mcp:manage");
  const serverQ = useMcpServer(serverId);
  const toolsQ = useMcpTools(serverId);
  const lastSync = useLastSync(serverId);
  const [reviewing, setReviewing] = React.useState<McpToolOut | null>(null);

  const back = (
    <Link href="/app/mcp" className="inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg">
      <ArrowLeftIcon className="size-3.5" aria-hidden /> MCP Center
    </Link>
  );

  if (serverQ.isError && !serverQ.data) {
    return (
      <PageContainer>
        <div className="pb-4">{back}</div>
        <ErrorState error={serverQ.error} onRetry={() => void serverQ.refetch()} />
      </PageContainer>
    );
  }

  const server = serverQ.data;
  const tools = toolsQ.data ?? [];
  const counts = server ? countTools(tools, server) : null;
  const reviewingLive = reviewing ? (tools.find((t) => t.id === reviewing.id) ?? reviewing) : null;
  const info = server?.server_info ?? {};
  const infoName = [info.title ?? info.name, info.version].filter((v) => typeof v === "string" && v).join(" · ");

  return (
    <PageContainer width="wide">
      {!server ? (
        <div className="flex flex-col gap-3 pb-6">
          {back}
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
      ) : (
        <header className="flex flex-col gap-4 pb-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            {back}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg border border-line-strong bg-surface-2 text-fg-muted">
                <BlocksIcon className="size-4.5" aria-hidden />
              </div>
              <h1 className="font-mono text-2xl font-semibold tracking-tight text-fg">{server.name}</h1>
              <span aria-live="polite">
                <ServerStatusBadge status={server.status} />
              </span>
            </div>
            <div className="flex min-w-0 items-center gap-1 font-mono text-xs text-fg-muted">
              <span className="truncate">{server.url}</span>
              <CopyButton value={server.url} label="Copy URL" className="size-6" />
            </div>
          </div>
          {canManage && <ServerActionBar server={server} onDeleted={() => router.push("/app/mcp")} />}
        </header>
      )}

      {server && (
        <div className="flex flex-col gap-5">
          <StatusBanner server={server} />
          {lastSync.data && (
            <SyncResultPanel
              result={lastSync.data.result}
              at={lastSync.data.at}
              onDismiss={() => qc.setQueryData(lastSyncKey(serverId), null)}
            />
          )}
          {toolsQ.data && <AttentionBanner tools={tools} server={server} onReview={(t) => setReviewing(t)} />}

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <section aria-labelledby="mcp-tools-heading" className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 id="mcp-tools-heading" className="text-sm font-semibold tracking-tight text-fg">
                    Tools
                  </h2>
                  {counts && counts.total > 0 && (
                    <p className="text-xs text-fg-subtle">
                      {counts.usable} of {counts.total} enabled
                      {counts.schemaChanged > 0 && (
                        <span className="text-danger"> · {counts.schemaChanged} changed</span>
                      )}
                      {counts.unreviewed > 0 && <span className="text-warning"> · {counts.unreviewed} to review</span>}
                      {counts.removed > 0 && <span> · {counts.removed} removed</span>}
                    </p>
                  )}
                </div>
              </div>
              {toolsQ.isError && !toolsQ.data ? (
                <ErrorState error={toolsQ.error} onRetry={() => void toolsQ.refetch()} compact />
              ) : toolsQ.isLoading ? (
                <Card className="divide-y divide-line">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="ml-auto h-5 w-40" />
                    </div>
                  ))}
                </Card>
              ) : tools.length === 0 ? (
                <Card>
                  <EmptyState
                    size="sm"
                    icon={<RefreshCwIcon />}
                    title={
                      server.status === "pending_review"
                        ? "Approve the server to discover its tools"
                        : "No tools discovered yet"
                    }
                    description={
                      server.status === "pending_review"
                        ? "Tools are listed after the first successful sync, which requires an approved server."
                        : canSync(server)
                          ? "Run a sync to list the tools this server advertises. They are stored disabled until you review them."
                          : "Approve the server again to sync its tools."
                    }
                  />
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  <ul className="divide-y divide-line" aria-label={`Tools on ${server.name}`}>
                    {[...tools]
                      .sort((a, b) => {
                        const rank = (t: McpToolOut) =>
                          ({
                            schema_changed: 0,
                            unknown: 1,
                            unreviewed: 2,
                            usable: 3,
                            disabled: 4,
                            server_blocked: 4,
                            removed: 5,
                          })[reviewState(t, server)];
                        return rank(a) - rank(b) || a.qualified_name.localeCompare(b.qualified_name);
                      })
                      .map((t) => (
                        <McpToolRow key={t.id} tool={t} server={server} canManage={canManage} onReview={setReviewing} />
                      ))}
                  </ul>
                </Card>
              )}
            </section>

            <aside className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold tracking-tight text-fg">Server</h2>
              <Card className="p-4">
                <KeyValue
                  className="grid-cols-[minmax(6.5rem,auto)_1fr] text-xs"
                  items={[
                    [
                      "Transport",
                      <span key="t" className="font-mono">
                        {server.transport}
                      </span>,
                    ],
                    [
                      "Protocol",
                      server.protocol_version ? (
                        <span key="p" className="font-mono">
                          {server.protocol_version}
                        </span>
                      ) : (
                        <span key="p" className="text-fg-subtle">
                          Unknown until synced
                        </span>
                      ),
                    ],
                    [
                      "Reports as",
                      infoName || (
                        <span key="i" className="text-fg-subtle">
                          —
                        </span>
                      ),
                    ],
                    [
                      "Auth",
                      server.has_auth ? (
                        <span key="a" className="flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1">
                            <KeyRoundIcon className="size-3 text-fg-subtle" aria-hidden />
                            <span className="font-mono">
                              {server.auth_header_name ?? (server.auth_credential_id ? "stored credential" : "header")}
                            </span>
                          </span>
                          <span className="text-fg-subtle">Value encrypted · write-only</span>
                        </span>
                      ) : (
                        <span key="a" className="text-fg-subtle">
                          None
                        </span>
                      ),
                    ],
                    ["Timeout", `${server.timeout_seconds} s`],
                    ["Rate limit", `${server.rate_limit_per_minute} / min`],
                    [
                      "Registered",
                      <span key="r" title={dateTime(server.created_at)}>
                        <RelativeTime value={server.created_at} />
                      </span>,
                    ],
                    [
                      "Approved",
                      server.approved_at ? (
                        <RelativeTime key="ap" value={server.approved_at} />
                      ) : (
                        <span key="ap" className="text-fg-subtle">
                          Not approved
                        </span>
                      ),
                    ],
                    [
                      "Last sync",
                      server.last_sync_at ? (
                        <RelativeTime key="ls" value={server.last_sync_at} />
                      ) : (
                        <span key="ls" className="text-fg-subtle">
                          Never
                        </span>
                      ),
                    ],
                  ]}
                />
                {developerMode && (
                  <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
                    <IdChip id={server.id} label="server" />
                    {server.approved_by && <IdChip id={server.approved_by} label="approved by" />}
                    <JsonViewer value={server} />
                  </div>
                )}
              </Card>
              <p className="text-2xs leading-relaxed text-fg-subtle">
                Tools are exposed to agents as <span className="font-mono">mcp.{server.name}.*</span>. Organization tool
                rules and each agent&apos;s tool policy apply to them like any other tool.
              </p>
            </aside>
          </div>
        </div>
      )}
      {server && (
        <ToolReviewDialog tool={reviewingLive} server={server} onOpenChange={(o) => !o && setReviewing(null)} />
      )}
    </PageContainer>
  );
}
