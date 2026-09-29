"use client";

import { ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { IdChip, JsonViewer, KeyValue, RelativeTime } from "@/components/ui/data-display";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/drawer";
import { RequestId } from "@/components/ui/states";
import type { AuditOut, MemberOut } from "@/lib/api";
import { dateTime, humanize, humanizeTool } from "@/lib/format";
import { useUiStore } from "@/stores/ui";
import { ACTOR_LABEL, auditStatusTone, CATEGORY_LABEL, CATEGORY_TONE } from "./audit-meta";

function summarizeValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (Array.isArray(value))
    return value.every((v) => typeof v !== "object") ? value.join(", ") || "—" : `${value.length} items`;
  const keys = Object.keys(value as object);
  return keys.length ? `${keys.length} fields` : "—";
}

export function ActorLabel({ entry, member }: { entry: AuditOut; member?: MemberOut }) {
  if (member) {
    return (
      <span className="min-w-0">
        <span className="block truncate text-fg">{member.display_name || member.email}</span>
        {member.display_name && <span className="block truncate text-2xs text-fg-subtle">{member.email}</span>}
      </span>
    );
  }
  const type = ACTOR_LABEL[entry.actor_type] ?? humanize(entry.actor_type);
  if (entry.user_id && entry.actor_type === "user") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-fg-muted">User</span>
        <IdChip id={entry.user_id} />
      </span>
    );
  }
  return <span className="text-fg-muted">{type}</span>;
}

export function AuditDetailSheet({
  entry,
  member,
  onOpenChange,
  crossTenant,
}: {
  entry: AuditOut | null;
  member?: MemberOut;
  onOpenChange: (open: boolean) => void;
  /** Platform views: tasks may belong to another organization, so don't deep-link into this tenant. */
  crossTenant?: boolean;
}) {
  const developerMode = useUiStore((s) => s.developerMode);
  const meta = entry?.metadata ?? {};
  const metaEntries = Object.entries(meta);

  const items: Array<[ReactNode, ReactNode]> = entry
    ? [
        [
          "When",
          <span key="w">
            {dateTime(entry.created_at)}{" "}
            <span className="text-fg-subtle">
              (<RelativeTime value={entry.created_at} />)
            </span>
          </span>,
        ],
        ["Actor", <ActorLabel key="a" entry={entry} member={member} />],
        ["Actor type", ACTOR_LABEL[entry.actor_type] ?? humanize(entry.actor_type)],
        ...(entry.resource_type || entry.resource_id
          ? ([
              [
                "Resource",
                <span key="r" className="inline-flex flex-wrap items-center gap-1.5">
                  {entry.resource_type && <span>{humanize(entry.resource_type)}</span>}
                  {entry.resource_id && <IdChip id={entry.resource_id} />}
                </span>,
              ],
            ] as Array<[ReactNode, ReactNode]>)
          : []),
        ...(entry.tool_name
          ? ([
              [
                "Tool",
                <span key="t" title={entry.tool_name}>
                  {humanizeTool(entry.tool_name)}{" "}
                  <span className="font-mono text-2xs text-fg-subtle">{entry.tool_name}</span>
                </span>,
              ],
            ] as Array<[ReactNode, ReactNode]>)
          : []),
        ...(entry.task_id
          ? ([
              [
                "Task",
                crossTenant ? (
                  <IdChip key="task" id={entry.task_id} />
                ) : (
                  <Link
                    key="task"
                    href={`/app/tasks/${entry.task_id}`}
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                  >
                    Open task <ExternalLinkIcon className="size-3" aria-hidden />
                  </Link>
                ),
              ],
            ] as Array<[ReactNode, ReactNode]>)
          : []),
        ...(entry.step_id ? ([["Step", <IdChip key="s" id={entry.step_id} />]] as Array<[ReactNode, ReactNode]>) : []),
        ...(entry.approval_id
          ? ([["Approval", <IdChip key="ap" id={entry.approval_id} />]] as Array<[ReactNode, ReactNode]>)
          : []),
        ...(entry.ip_address
          ? ([
              [
                "IP address",
                <span key="ip" className="font-mono text-[13px]">
                  {entry.ip_address}
                </span>,
              ],
            ] as Array<[ReactNode, ReactNode]>)
          : []),
        ...(crossTenant && entry.tenant_id
          ? ([["Organization", <IdChip key="org" id={entry.tenant_id} />]] as Array<[ReactNode, ReactNode]>)
          : []),
        ...(entry.request_id
          ? ([["Request", <RequestId key="rq" id={entry.request_id} />]] as Array<[ReactNode, ReactNode]>)
          : []),
        ...(developerMode ? ([["Entry ID", <IdChip key="id" id={entry.id} />]] as Array<[ReactNode, ReactNode]>) : []),
      ]
    : [];

  return (
    <Sheet open={entry !== null} onOpenChange={onOpenChange}>
      <SheetContent
        className="max-w-lg"
        onOpenAutoFocus={(e) => {
          // Focus the panel itself rather than the first id chip (which would pop its tooltip open).
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
      >
        {entry && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-line px-5 pt-5 pr-12 pb-4">
              <div className="mb-2 flex flex-wrap gap-1.5">
                <Badge tone={CATEGORY_TONE[entry.category] ?? "neutral"} variant="outline">
                  {CATEGORY_LABEL[entry.category] ?? humanize(entry.category)}
                </Badge>
                <Badge tone={auditStatusTone(entry.status)}>{humanize(entry.status)}</Badge>
              </div>
              <SheetTitle className="font-mono text-[15px] font-medium break-all text-fg">{entry.action}</SheetTitle>
              <SheetDescription className="mt-1 text-[13px] text-fg-muted">
                {entry.result_summary || "Audit entry details"}
              </SheetDescription>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <KeyValue items={items} />
              <div className="mt-6">
                <h3 className="mb-2 text-2xs font-medium tracking-wider text-fg-subtle uppercase">Details</h3>
                {metaEntries.length === 0 ? (
                  <p className="text-[13px] text-fg-subtle">No additional details were recorded.</p>
                ) : developerMode ? (
                  <JsonViewer value={meta} />
                ) : (
                  <KeyValue
                    items={metaEntries.map(([k, v]) => [
                      humanize(k),
                      <span key={k} className="break-words">
                        {summarizeValue(v)}
                      </span>,
                    ])}
                  />
                )}
                {!developerMode && metaEntries.some(([, v]) => v !== null && typeof v === "object") && (
                  <p className="mt-3 text-xs text-fg-subtle">
                    Turn on developer details (account menu) to see the full raw record.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
