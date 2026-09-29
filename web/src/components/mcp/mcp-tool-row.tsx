"use client";

import { ChevronDownIcon, ShieldAlertIcon } from "lucide-react";
import * as React from "react";
import { Badge, PermissionBadge, RiskBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { IdChip, JsonViewer, KeyValue, RelativeTime } from "@/components/ui/data-display";
import { toast, toastError } from "@/components/ui/toaster";
import { Tooltip } from "@/components/ui/tooltip";
import type { McpServerOut, McpToolOut } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { enableBlockedReason, reviewTool, shortHash } from "./mcp-review";
import { useUpdateMcpTool } from "./queries";
import { DefinitionReview } from "./tool-review-dialog";
import { GovernanceFields, governanceDiff, governanceOf, type GovernanceValues } from "./tool-governance";

export function ToolReviewBadge({ tool, server }: { tool: McpToolOut; server: McpServerOut }) {
  const r = reviewTool(tool, server);
  return (
    <Badge tone={r.tone} title={r.description}>
      {r.state === "schema_changed" && <ShieldAlertIcon className="size-3" aria-hidden />}
      {r.label}
    </Badge>
  );
}

function GovernanceEditor({ tool, server, canManage }: { tool: McpToolOut; server: McpServerOut; canManage: boolean }) {
  const update = useUpdateMcpTool(server.id);
  const [draft, setDraft] = React.useState<GovernanceValues>(() => governanceOf(tool));
  const [baseline, setBaseline] = React.useState(tool.updated_at);
  if (baseline !== tool.updated_at) {
    setBaseline(tool.updated_at);
    setDraft(governanceOf(tool));
  }
  const changes = governanceDiff(tool, draft);
  const dirty = Object.keys(changes).length > 0;
  return (
    <div className="flex flex-col gap-3">
      <GovernanceFields value={draft} onChange={setDraft} disabled={!canManage || update.isPending} compact />
      {canManage && (
        <div className="flex items-center justify-end gap-2">
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setDraft(governanceOf(tool))}>
              Reset
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={!dirty}
            loading={update.isPending}
            onClick={async () => {
              try {
                await update.mutateAsync({ toolId: tool.id, body: changes });
                toast.success("Tool policy saved", { description: tool.qualified_name });
              } catch (err) {
                toastError(err, "Couldn't save the tool policy");
              }
            }}
          >
            Save policy
          </Button>
        </div>
      )}
    </div>
  );
}

export function McpToolRow({
  tool,
  server,
  canManage,
  onReview,
  defaultOpen,
}: {
  tool: McpToolOut;
  server: McpServerOut;
  canManage: boolean;
  onReview: (tool: McpToolOut) => void;
  defaultOpen?: boolean;
}) {
  const developerMode = useUiStore((s) => s.developerMode);
  const update = useUpdateMcpTool(server.id);
  const [open, setOpen] = React.useState(Boolean(defaultOpen));
  const review = reviewTool(tool, server);
  const blocked = enableBlockedReason(tool, server);
  const detailsId = React.useId();

  const toggle = async (on: boolean) => {
    if (on && review.requiresReview) {
      onReview(tool);
      return;
    }
    try {
      await update.mutateAsync({ toolId: tool.id, body: { enabled: on } });
      toast.success(on ? `${tool.qualified_name} enabled` : `${tool.qualified_name} disabled`);
    } catch (err) {
      toastError(err, on ? "Couldn't enable the tool" : "Couldn't disable the tool");
    }
  };

  const switchEl = (
    <Switch
      checked={tool.enabled}
      onCheckedChange={(v) => void toggle(v)}
      disabled={!canManage || update.isPending || (!tool.enabled && blocked !== null)}
      aria-label={`${tool.enabled ? "Disable" : "Enable"} ${tool.qualified_name}`}
    />
  );

  return (
    <li
      className={cn(
        "flex flex-col",
        review.state === "schema_changed" && "bg-danger/[0.035]",
        review.state === "unreviewed" && "bg-warning/[0.03]",
      )}
    >
      <div className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={detailsId}
          className="flex min-w-0 flex-1 items-start gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <ChevronDownIcon
            className={cn("mt-0.5 size-4 shrink-0 text-fg-subtle transition-transform", !open && "-rotate-90")}
            aria-hidden
          />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] font-medium text-fg">{tool.qualified_name}</span>
              {tool.title && <span className="text-xs text-fg-muted">{tool.title}</span>}
            </span>
            <span className={cn("mt-0.5 block text-xs leading-relaxed text-fg-muted", !open && "line-clamp-1")}>
              {tool.description || "No description"}
            </span>
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-1.5 pl-6 md:pl-0">
          <ToolReviewBadge tool={tool} server={server} />
          <PermissionBadge level={tool.permission_level} />
          <RiskBadge level={tool.risk_level} />
          {tool.requires_approval && (
            <Badge tone="warning" variant="outline">
              Approval
            </Badge>
          )}
          {canManage && review.requiresReview && review.state !== "unknown" ? (
            <Button
              size="xs"
              variant={review.state === "schema_changed" ? "danger" : "primary"}
              onClick={() => onReview(tool)}
              disabled={blocked !== null}
            >
              {review.state === "schema_changed" ? "Re-approve" : "Review"}
            </Button>
          ) : blocked && !tool.enabled ? (
            <Tooltip content={blocked}>
              <span tabIndex={0} className="inline-flex outline-none">
                {switchEl}
              </span>
            </Tooltip>
          ) : (
            switchEl
          )}
        </div>
      </div>
      {open && (
        <div
          id={detailsId}
          className="grid gap-6 border-t border-line bg-surface-2/40 px-4 py-4 pl-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]"
        >
          <DefinitionReview tool={tool} />
          <div className="flex flex-col gap-5">
            <p className="text-xs leading-relaxed text-fg-muted">{review.description}</p>
            <div>
              <p className="mb-2 text-xs text-fg-subtle">Policy</p>
              <GovernanceEditor tool={tool} server={server} canManage={canManage} />
            </div>
            <KeyValue
              className="grid-cols-[minmax(7rem,auto)_1fr] text-xs"
              items={[
                [
                  "Remote name",
                  <span key="r" className="font-mono">
                    {tool.remote_name}
                  </span>,
                ],
                [
                  "Definition hash",
                  <span key="h" className="font-mono" title={tool.schema_hash}>
                    {shortHash(tool.schema_hash)}
                  </span>,
                ],
                [
                  "Approved hash",
                  <span
                    key="a"
                    className={cn("font-mono", !tool.schema_approved && tool.approved_schema_hash && "text-danger")}
                    title={tool.approved_schema_hash ?? undefined}
                  >
                    {tool.approved_schema_hash ? shortHash(tool.approved_schema_hash) : "never approved"}
                  </span>,
                ],
                ["Approved", tool.approved_at ? <RelativeTime key="at" value={tool.approved_at} /> : "—"],
                ["Last seen", <RelativeTime key="ls" value={tool.last_seen_at} />],
                ["Discovered", <RelativeTime key="c" value={tool.created_at} />],
              ]}
            />
            {developerMode && (
              <div className="flex flex-col gap-2">
                <IdChip id={tool.id} label="tool" />
                <JsonViewer value={tool} />
              </div>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
