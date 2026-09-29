"use client";

import { ChevronRightIcon, PlugIcon, SearchIcon, WrenchIcon, XIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { PermissionBadge, RiskBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Skeleton } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Tooltip } from "@/components/ui/tooltip";
import { permissionLevelValues, type ToolOut, type ToolRuleOut } from "@/lib/api";
import { usePermissions } from "@/lib/auth/hooks";
import { permissionLevelMeta } from "@/lib/status";
import { cn } from "@/lib/utils";
import { capabilityForScope, shortScope } from "@/components/integrations/google-capabilities";
import { activeGoogleConnection, useConnections } from "@/components/integrations/queries";
import { ApprovalBadge, ToolDetailSheet } from "./tool-detail-sheet";
import { ToolConnectionStatus, toolAccess } from "./tool-connection";
import {
  asPermissionLevel,
  asRiskLevel,
  categoryLabel,
  filterTools,
  groupByCategory,
  providerLabel,
  verificationLabel,
  type ToolFilters,
} from "./tool-meta";

function ToolRow({ tool, onOpen }: { tool: ToolOut; onOpen: () => void }) {
  const level = asPermissionLevel(tool.permission_level);
  const risk = asRiskLevel(tool.risk_level);
  return (
    <li className="group relative flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-white/[0.02] md:flex-row md:items-center md:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="font-mono text-[13px] font-medium text-fg outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-accent/50 focus-visible:after:ring-inset"
          >
            {tool.name}
          </button>
          <span className="font-mono text-2xs text-fg-subtle">{tool.version}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-fg-muted">{tool.description}</p>
        {tool.required_scopes.length > 0 && (
          <div className="relative z-10 mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-2xs text-fg-subtle">Needs</span>
            {tool.required_scopes.map((s) => (
              <Tooltip key={s} content={<span className="font-mono">{s}</span>}>
                <span
                  tabIndex={0}
                  className="rounded border border-line px-1.5 font-mono text-2xs text-fg-muted outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  {capabilityForScope(s)?.id ?? shortScope(s)}
                </span>
              </Tooltip>
            ))}
            <ToolConnectionStatus tool={tool} compact />
          </div>
        )}
      </div>
      <div className="relative z-10 flex flex-wrap items-center gap-1.5 md:w-[24rem] md:justify-end">
        <span className="hidden text-2xs text-fg-subtle xl:inline" title="Verification method">
          {verificationLabel(tool.verification_method)}
        </span>
        {level && <PermissionBadge level={level} />}
        {risk && <RiskBadge level={risk} />}
        <ApprovalBadge tool={tool} />
      </div>
      <ChevronRightIcon className="hidden size-4 shrink-0 text-fg-subtle md:block" aria-hidden />
    </li>
  );
}

function ConnectionSummary({ tools }: { tools: ToolOut[] }) {
  const { can } = usePermissions();
  const connections = useConnections();
  const google = tools.filter((t) => t.provider === "google" && t.required_scopes.length > 0);
  if (google.length === 0 || connections.isLoading) return null;
  const conn = activeGoogleConnection(connections.data);
  const notReady = google.filter((t) => !toolAccess(t, connections.data)?.ready);
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border px-4 py-3 text-[13px] sm:flex-row sm:items-center sm:justify-between",
        notReady.length === 0 ? "border-success/25 bg-success/[0.05]" : "border-warning/25 bg-warning/[0.05]",
      )}
    >
      <div className="flex items-start gap-2.5">
        <PlugIcon
          className={cn("mt-0.5 size-4 shrink-0", notReady.length === 0 ? "text-success" : "text-warning")}
          aria-hidden
        />
        <p className="text-fg-muted">
          <span className="font-medium text-fg">Google Workspace</span>{" "}
          {conn ? (
            <>
              — connected as <span className="text-fg">{conn.account_email ?? "your account"}</span>.{" "}
              {notReady.length === 0
                ? `All ${google.length} Google tools have the access they need.`
                : `${notReady.length} of ${google.length} Google tools need access that isn't granted yet.`}
            </>
          ) : (
            <>— not connected. {google.length} tools act on Gmail, Calendar or Drive and need a connection.</>
          )}
        </p>
      </div>
      {can("integrations:manage") && (
        <Button asChild size="xs" variant="outline" className="self-start sm:self-auto">
          <Link href="/app/integrations">Manage connection</Link>
        </Button>
      )}
    </div>
  );
}

const ALL = "all";

export function ToolCatalog({
  tools,
  isLoading,
  error,
  onRetry,
  rules,
}: {
  tools?: ToolOut[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  rules?: ToolRuleOut[];
}) {
  const [filters, setFilters] = React.useState<ToolFilters>({
    query: "",
    category: ALL,
    permission: ALL,
    approvalOnly: false,
  });
  const [openName, setOpenName] = React.useState<string | null>(null);
  const approvalId = React.useId();
  const all = React.useMemo(() => tools ?? [], [tools]);
  const categories = React.useMemo(
    () => [...new Set(all.map((t) => t.category))].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b))),
    [all],
  );
  const visible = React.useMemo(() => filterTools(all, filters), [all, filters]);
  const groups = React.useMemo(() => groupByCategory(visible), [visible]);
  const open = all.find((t) => t.name === openName) ?? null;
  const filtered =
    filters.query !== "" || filters.category !== ALL || filters.permission !== ALL || filters.approvalOnly;

  if (error && all.length === 0) return <ErrorState error={error} onRetry={onRetry} />;

  return (
    <div className="flex flex-col gap-4">
      <ConnectionSummary tools={all} />
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="Search tools"
            placeholder="Search by name, description or scope…"
            value={filters.query}
            onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filters.category} onValueChange={(category) => setFilters((f) => ({ ...f, category }))}>
            <SelectTrigger aria-label="Category" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {categoryLabel(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.permission} onValueChange={(permission) => setFilters((f) => ({ ...f, permission }))}>
            <SelectTrigger aria-label="Permission level" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All permission levels</SelectItem>
              {permissionLevelValues.map((p) => (
                <SelectItem key={p} value={p}>
                  {permissionLevelMeta[p].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label
            htmlFor={approvalId}
            className="flex h-9 items-center gap-2 rounded-md border border-line-strong bg-surface-1 px-3 text-[13px] text-fg-muted"
          >
            <Checkbox
              id={approvalId}
              checked={filters.approvalOnly}
              onCheckedChange={(v) => setFilters((f) => ({ ...f, approvalOnly: v === true }))}
            />
            Needs approval
          </label>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilters({ query: "", category: ALL, permission: ALL, approvalOnly: false })}
            >
              <XIcon /> Clear
            </Button>
          )}
        </div>
      </div>

      <p className="text-xs text-fg-subtle" aria-live="polite">
        {isLoading
          ? "Loading tools…"
          : filtered
            ? `Showing ${visible.length} of ${all.length} tools`
            : `${all.length} tools`}
      </p>

      {isLoading ? (
        <Card className="divide-y divide-line">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5">
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-3 w-3/4" />
              </div>
              <Skeleton className="h-5 w-40" />
            </div>
          ))}
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            size="sm"
            icon={<WrenchIcon />}
            title={all.length === 0 ? "No tools are available" : "No tools match these filters"}
            description={
              all.length === 0
                ? "The tool catalogue is empty for your organization."
                : "Try a different search or clear the filters."
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => {
            const providers = [...new Set(g.tools.map((t) => providerLabel(t.provider)))];
            return (
              <section key={g.category} aria-labelledby={`cat-${g.category}`}>
                <div className="mb-2 flex items-baseline gap-2 px-1">
                  <h2 id={`cat-${g.category}`} className="text-sm font-semibold tracking-tight text-fg">
                    {categoryLabel(g.category)}
                  </h2>
                  <span className="text-xs text-fg-subtle">
                    {g.tools.length} {g.tools.length === 1 ? "tool" : "tools"} · {providers.join(", ")}
                  </span>
                </div>
                <Card className="overflow-hidden">
                  <ul className="divide-y divide-line">
                    {g.tools.map((t) => (
                      <ToolRow key={t.name} tool={t} onOpen={() => setOpenName(t.name)} />
                    ))}
                  </ul>
                </Card>
              </section>
            );
          })}
        </div>
      )}

      <ToolDetailSheet tool={open} rules={rules} onOpenChange={(o) => !o && setOpenName(null)} />
    </div>
  );
}
