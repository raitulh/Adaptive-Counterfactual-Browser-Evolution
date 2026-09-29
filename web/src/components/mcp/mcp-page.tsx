"use client";

import { BlocksIcon, KeyRoundIcon, LockIcon, PlusIcon, ServerIcon, ShieldAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Badge, LiveDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/controls";
import { MetricCard, RelativeTime } from "@/components/ui/data-display";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Tooltip } from "@/components/ui/tooltip";
import type { McpServerOut, McpToolOut } from "@/lib/api";
import { usePermissions } from "@/lib/auth/hooks";
import { cn } from "@/lib/utils";
import { countTools, serverStatusMeta } from "./mcp-review";
import { useMcpServers, useMcpToolsForServers } from "./queries";
import { RegisterServerDialog } from "./register-server-dialog";
import { ServerActionBar } from "./server-actions";

export function ServerStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = serverStatusMeta(status);
  return (
    <Badge tone={meta.tone} className={className} title={meta.description}>
      <LiveDot tone={meta.tone} live={false} />
      {meta.label}
    </Badge>
  );
}

function ToolCountsCell({ tools, server, loading }: { tools?: McpToolOut[]; server: McpServerOut; loading: boolean }) {
  if (loading && !tools) return <Skeleton className="h-4 w-24" />;
  if (!tools) return <span className="text-xs text-fg-subtle">—</span>;
  if (tools.length === 0)
    return (
      <span className="text-xs text-fg-subtle">{server.last_sync_at ? "No tools advertised" : "Not synced yet"}</span>
    );
  const c = countTools(tools, server);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="text-fg">
        <span className="font-medium tabular-nums">{c.usable}</span>
        <span className="text-fg-subtle"> / {c.total} enabled</span>
      </span>
      {c.schemaChanged > 0 && (
        <Badge tone="danger">
          <ShieldAlertIcon className="size-3" aria-hidden /> {c.schemaChanged} changed
        </Badge>
      )}
      {c.unreviewed > 0 && <Badge tone="warning">{c.unreviewed} to review</Badge>}
    </div>
  );
}

function ServerRow({
  server,
  tools,
  toolsLoading,
  canManage,
}: {
  server: McpServerOut;
  tools?: McpToolOut[];
  toolsLoading: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  return (
    <li className="group relative grid gap-3 px-4 py-4 transition-colors hover:bg-white/[0.02] md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center md:gap-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/app/mcp/${server.id}`}
            className="font-mono text-sm font-medium text-fg outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-accent/50 focus-visible:after:ring-inset"
          >
            {server.name}
          </Link>
          <ServerStatusBadge status={server.status} />
        </div>
        <p className="mt-1 truncate font-mono text-2xs text-fg-subtle" title={server.url}>
          {server.url}
        </p>
        <p className="mt-1 flex items-center gap-1 text-2xs text-fg-subtle">
          {server.has_auth ? (
            <>
              <KeyRoundIcon className="size-3" aria-hidden />{" "}
              <span className="font-mono">{server.auth_header_name ?? "credential"}</span> header set
            </>
          ) : (
            <>
              <LockIcon className="size-3" aria-hidden /> No authentication
            </>
          )}
        </p>
      </div>
      <div className="relative">
        <p className="mb-0.5 text-2xs tracking-wider text-fg-subtle uppercase md:hidden">Tools</p>
        <ToolCountsCell tools={tools} server={server} loading={toolsLoading} />
      </div>
      <div className="relative min-w-0 text-xs">
        <p className="mb-0.5 text-2xs tracking-wider text-fg-subtle uppercase md:hidden">Last sync</p>
        {server.last_sync_at ? (
          <span className="text-fg-muted">
            Synced <RelativeTime value={server.last_sync_at} />
          </span>
        ) : (
          <span className="text-fg-subtle">Never synced</span>
        )}
        {server.last_error && (
          <Tooltip content={server.last_error}>
            <p tabIndex={0} className="mt-0.5 truncate font-mono text-2xs text-danger outline-none">
              {server.last_error}
            </p>
          </Tooltip>
        )}
      </div>
      <div className="relative z-10 flex justify-end">
        {canManage ? (
          <ServerActionBar server={server} size="xs" onSynced={() => router.push(`/app/mcp/${server.id}`)} />
        ) : (
          <Button asChild size="xs" variant="ghost">
            <Link href={`/app/mcp/${server.id}`}>Open</Link>
          </Button>
        )}
      </div>
    </li>
  );
}

export function McpPage() {
  const { can } = usePermissions();
  const canManage = can("mcp:manage");
  const servers = useMcpServers();
  const [registerOpen, setRegisterOpen] = React.useState(false);
  const list = React.useMemo(() => servers.data ?? [], [servers.data]);
  const toolQueries = useMcpToolsForServers(list.map((s) => s.id));

  const totals = React.useMemo(() => {
    let usable = 0;
    let attention = 0;
    let changed = 0;
    list.forEach((s, i) => {
      const tools = toolQueries[i]?.data;
      if (!tools) return;
      const c = countTools(tools, s);
      usable += c.usable;
      attention += c.unreviewed + c.schemaChanged;
      changed += c.schemaChanged;
    });
    return {
      usable,
      attention,
      changed,
      pending: list.filter((s) => s.status === "pending_review").length,
      approved: list.filter((s) => s.status === "approved").length,
    };
  }, [list, toolQueries]);

  const registerButton = canManage ? (
    <Button variant="primary" size="sm" onClick={() => setRegisterOpen(true)}>
      <PlusIcon /> Register server
    </Button>
  ) : null;

  return (
    <PageContainer width="wide">
      <PageHeader
        title="MCP Center"
        description="Connect Model Context Protocol servers and decide exactly which of their tools agents may call. Nothing a server advertises is trusted until an admin approves the server and each tool's definition."
        actions={registerButton}
      />

      {servers.isError && !servers.data ? (
        <ErrorState error={servers.error} onRetry={() => void servers.refetch()} />
      ) : servers.isLoading ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-48 rounded-xl" />
        </div>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BlocksIcon />}
            title="No MCP servers yet"
            description={
              canManage
                ? "Register a Streamable HTTP MCP server. It stays pending until an admin approves it; each discovered tool then needs its own review before agents can call it."
                : "No MCP servers are registered in this organization. Members with the mcp:manage permission can register one."
            }
            action={registerButton}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              label="Servers"
              value={list.length}
              hint={`${totals.approved} approved`}
              icon={<ServerIcon />}
            />
            <MetricCard
              label="Awaiting approval"
              value={totals.pending}
              hint="Servers not yet contacted"
              className={cn(totals.pending > 0 && "border-warning/30")}
            />
            <MetricCard label="Tools enabled" value={totals.usable} hint="Callable by agents now" />
            <MetricCard
              label="Needs review"
              value={totals.attention}
              hint={totals.changed > 0 ? `${totals.changed} changed since approval` : "New or changed tool definitions"}
              icon={totals.changed > 0 ? <ShieldAlertIcon className="text-danger" /> : undefined}
              className={cn(totals.changed > 0 ? "border-danger/35" : totals.attention > 0 && "border-warning/30")}
            />
          </div>
          <Card className="overflow-hidden">
            <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-5 border-b border-line px-4 py-2 text-2xs font-medium tracking-wider text-fg-subtle uppercase md:grid">
              <span>Server</span>
              <span>Tools</span>
              <span>Sync</span>
              <span className="sr-only">Actions</span>
            </div>
            <ul className="divide-y divide-line" aria-label="MCP servers">
              {list.map((s, i) => (
                <ServerRow
                  key={s.id}
                  server={s}
                  tools={toolQueries[i]?.data}
                  toolsLoading={Boolean(toolQueries[i]?.isLoading)}
                  canManage={canManage}
                />
              ))}
            </ul>
          </Card>
        </div>
      )}
      {canManage && <RegisterServerDialog open={registerOpen} onOpenChange={setRegisterOpen} />}
    </PageContainer>
  );
}
