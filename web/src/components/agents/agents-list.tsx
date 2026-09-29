"use client";

import { BotIcon, LayoutGridIcon, ListIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/controls";
import { RelativeTime } from "@/components/ui/data-display";
import { DataTable } from "@/components/ui/data-table";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { EmptyState, ErrorState } from "@/components/ui/states";
import type { AgentOut } from "@/lib/api";
import { usePermissions } from "@/lib/auth/hooks";
import { cn } from "@/lib/utils";
import { AgentStatusBadge, VersionBadge } from "./agent-status";
import { useAgentsList } from "./queries";

function toolSummary(agent: AgentOut): string {
  const allowed = agent.current_version?.tool_policy?.allowed ?? ["*"];
  const denied = agent.current_version?.tool_policy?.denied ?? [];
  if (allowed.length === 0) return "No tools";
  const base = allowed.includes("*")
    ? "All tools"
    : `${allowed.length} tool ${allowed.length === 1 ? "pattern" : "patterns"}`;
  return denied.length ? `${base} · ${denied.length} denied` : base;
}

function tierLabel(agent: AgentOut): string {
  const t = agent.current_version?.model_policy?.planning_tier ?? "default";
  return `${t.charAt(0).toUpperCase()}${t.slice(1)} tier`;
}

function AgentCard({ agent }: { agent: AgentOut }) {
  return (
    <Card interactive className="group relative flex h-full flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface-2 text-fg-muted">
            <BotIcon className="size-4" aria-hidden />
          </div>
          <h2 className="min-w-0 truncate text-sm font-semibold tracking-tight text-fg">
            <Link
              href={`/app/agents/${agent.id}`}
              className="outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-accent/60"
            >
              {agent.name}
            </Link>
          </h2>
        </div>
        <AgentStatusBadge status={agent.status} />
      </div>
      <p
        className={cn(
          "line-clamp-2 min-h-[2.5rem] text-[13px] leading-relaxed",
          agent.description ? "text-fg-muted" : "text-fg-subtle italic",
        )}
      >
        {agent.description || "No description"}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-3 text-xs text-fg-subtle">
        <VersionBadge number={agent.current_version?.version_number} current />
        <span>{tierLabel(agent)}</span>
        <span>{toolSummary(agent)}</span>
        <span className="ml-auto">
          Updated <RelativeTime value={agent.updated_at} />
        </span>
      </div>
    </Card>
  );
}

function CardSkeleton() {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-8 rounded-lg" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-2/3" />
      <Skeleton className="mt-2 h-5 w-full" />
    </Card>
  );
}

type View = "grid" | "list";

export function AgentsPage() {
  const { can } = usePermissions();
  const canManage = can("agents:manage");
  const router = useRouter();
  const q = useAgentsList();
  const [view, setView] = React.useState<View>("grid");

  const createButton = canManage ? (
    <Button asChild variant="primary" size="sm">
      <Link href="/app/agents/new">
        <PlusIcon /> Create agent
      </Link>
    </Button>
  ) : null;

  const viewToggle = (
    <div role="group" aria-label="Layout" className="inline-flex rounded-md border border-line bg-surface-1 p-0.5">
      {(
        [
          ["grid", LayoutGridIcon, "Grid"],
          ["list", ListIcon, "List"],
        ] as const
      ).map(([v, Icon, label]) => (
        <Button
          key={v}
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={label}
          aria-pressed={view === v}
          onClick={() => setView(v)}
          className={cn(view === v && "bg-surface-3 text-fg")}
        >
          <Icon />
        </Button>
      ))}
    </div>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Agents"
        description="Named, versioned configurations that decide how tasks are planned: instructions, models, tools, memory, limits and verification."
        actions={
          <>
            {q.items.length > 0 && viewToggle}
            {createButton}
          </>
        }
      />
      {q.isError && q.items.length === 0 ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading agents">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : q.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BotIcon />}
            title="Create your first agent"
            description={
              canManage
                ? "Give an agent instructions, the tools it may use and limits it must respect. Every change is kept as an immutable version you can compare."
                : "No agents have been created in this organization yet. Ask someone with the agents:manage permission to create one."
            }
            action={createButton}
          />
        </Card>
      ) : view === "grid" ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.items.map((a) => (
            <li key={a.id}>
              <AgentCard agent={a} />
            </li>
          ))}
        </ul>
      ) : (
        <DataTable<AgentOut>
          caption="Agents"
          rows={q.items}
          rowKey={(a) => a.id}
          onRowClick={(a) => router.push(`/app/agents/${a.id}`)}
          columns={[
            {
              id: "name",
              header: "Agent",
              cell: (a) => (
                <div className="min-w-0">
                  <Link
                    href={`/app/agents/${a.id}`}
                    className="font-medium text-fg hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {a.name}
                  </Link>
                  {a.description && <p className="line-clamp-1 max-w-md text-xs text-fg-muted">{a.description}</p>}
                </div>
              ),
            },
            { id: "status", header: "Status", cell: (a) => <AgentStatusBadge status={a.status} /> },
            {
              id: "version",
              header: "Version",
              cell: (a) => <VersionBadge number={a.current_version?.version_number} current />,
              hideBelow: "sm",
            },
            {
              id: "tools",
              header: "Tools",
              cell: (a) => <span className="text-fg-muted">{toolSummary(a)}</span>,
              hideBelow: "md",
            },
            {
              id: "updated",
              header: "Updated",
              cell: (a) => <RelativeTime value={a.updated_at} className="text-fg-muted" />,
              hideBelow: "sm",
            },
          ]}
        />
      )}
      {q.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
            Load more agents
          </Button>
        </div>
      )}
    </PageContainer>
  );
}
