import { Badge, LiveDot } from "@/components/ui/badge";
import type { StatusMeta } from "@/lib/status";

/** Agent status values accepted by the backend (`AgentUpdate.status` pattern ^(active|disabled)$). */
export const AGENT_STATUSES = ["active", "disabled"] as const;

export const agentStatusMeta: Record<(typeof AGENT_STATUSES)[number], StatusMeta> = {
  active: { label: "Active", tone: "success", description: "Tasks can run with this agent's current version." },
  disabled: { label: "Disabled", tone: "neutral", description: "New tasks cannot use this agent until it is re-enabled." },
};

export function AgentStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = (agentStatusMeta as Record<string, StatusMeta>)[status] ?? {
    label: status,
    tone: "neutral" as const,
    description: "Unrecognized status",
  };
  return (
    <Badge tone={meta.tone} className={className} title={meta.description}>
      <LiveDot tone={meta.tone} live={false} />
      {meta.label}
    </Badge>
  );
}

export function VersionBadge({ number, current, className }: { number: number | null | undefined; current?: boolean; className?: string }) {
  if (!number) return null;
  return (
    <Badge tone={current ? "accent" : "neutral"} variant="outline" className={className}>
      <span className="font-mono">v{number}</span>
      {current && <span className="text-fg-muted">· current</span>}
    </Badge>
  );
}
