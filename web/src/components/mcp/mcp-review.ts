/**
 * MCP governance logic, mirroring the backend gateway (app/mcp/service.py, app/mcp/policy.py):
 *
 *  - A newly discovered tool is stored *disabled* with no approved schema hash → it needs review.
 *  - Enabling a tool approves its *current* schema hash (PATCH /mcp/tools/{id} {enabled: true}).
 *  - When a sync sees an approved tool whose name/description/schemas/hints hash changed, the tool
 *    is set to `schema_changed` and disabled ("rug-pull" protection) until an admin re-approves it.
 *  - A tool the server stops advertising becomes `removed` (it cannot be enabled).
 *  - A tool is usable only when it is enabled, active, schema-approved and its server is approved.
 */
import type { McpServerOut, McpSyncResult, McpToolOut } from "@/lib/api";
import type { StatusMeta, Tone } from "@/lib/status";

export type McpServerStatusValue = "pending_review" | "approved" | "disabled" | "error";

export const mcpServerStatusMeta: Record<McpServerStatusValue, StatusMeta> = {
  pending_review: {
    label: "Awaiting approval",
    tone: "warning",
    attention: true,
    description: "Registered but not approved. Its tools cannot be synced or used until an admin approves the server.",
  },
  approved: {
    label: "Approved",
    tone: "success",
    description: "Approved. Tools can be synced and individually enabled.",
  },
  disabled: { label: "Disabled", tone: "neutral", description: "Disabled. None of its tools are available to agents." },
  error: {
    label: "Error",
    tone: "danger",
    attention: true,
    description: "The last sync failed with a non-transient error. Tools are unavailable until a sync succeeds.",
  },
};

export function serverStatusMeta(status: string): StatusMeta {
  return (
    (mcpServerStatusMeta as Record<string, StatusMeta>)[status] ?? {
      label: status,
      tone: "neutral",
      description: "Unrecognized status.",
    }
  );
}

export type ToolReviewState =
  "usable" | "unreviewed" | "schema_changed" | "removed" | "disabled" | "server_blocked" | "unknown";

export interface ToolReview {
  state: ToolReviewState;
  label: string;
  tone: Tone;
  description: string;
  /** Needs an admin decision (review or re-approval). */
  attention: boolean;
  /** The admin must explicitly re-confirm the current definition before enabling. */
  requiresReview: boolean;
}

const REVIEW: Record<ToolReviewState, Omit<ToolReview, "state">> = {
  usable: {
    label: "Enabled",
    tone: "success",
    attention: false,
    requiresReview: false,
    description: "Enabled with an approved definition. Agents can call it.",
  },
  unreviewed: {
    label: "Needs review",
    tone: "warning",
    attention: true,
    requiresReview: true,
    description: "Discovered by a sync and never approved. Review its description and input schema, then enable it.",
  },
  schema_changed: {
    label: "Changed since approval",
    tone: "danger",
    attention: true,
    requiresReview: true,
    description:
      "The server changed this tool's name, description, schemas or hints after it was approved. It was disabled automatically and stays off until you re-approve the new definition.",
  },
  removed: {
    label: "Removed",
    tone: "neutral",
    attention: false,
    requiresReview: false,
    description: "The server no longer advertises this tool. It cannot be enabled.",
  },
  disabled: {
    label: "Disabled",
    tone: "neutral",
    attention: false,
    requiresReview: false,
    description: "Approved definition, but turned off by an admin.",
  },
  server_blocked: {
    label: "Server not approved",
    tone: "neutral",
    attention: false,
    requiresReview: false,
    description: "The tool is enabled, but its server is not approved, so agents cannot use it.",
  },
  unknown: {
    label: "Unknown status",
    tone: "neutral",
    attention: true,
    requiresReview: true,
    description: "Unrecognized tool status.",
  },
};

export function reviewTool(tool: McpToolOut, server?: Pick<McpServerOut, "status"> | null): ToolReview {
  const state = reviewState(tool, server);
  return { state, ...REVIEW[state] };
}

export function reviewState(tool: McpToolOut, server?: Pick<McpServerOut, "status"> | null): ToolReviewState {
  if (tool.status === "removed") return "removed";
  const changed =
    tool.status === "schema_changed" ||
    (tool.approved_schema_hash !== null && tool.approved_schema_hash !== tool.schema_hash);
  if (changed) return "schema_changed";
  if (tool.status !== "active") return "unknown";
  if (tool.approved_schema_hash === null) return "unreviewed";
  if (!tool.enabled) return "disabled";
  if (tool.usable) return "usable";
  if (server && server.status !== "approved") return "server_blocked";
  return "disabled";
}

/** Why enabling is impossible right now (mirrors the backend's 409 preconditions), or null. */
export function enableBlockedReason(tool: McpToolOut, server: Pick<McpServerOut, "status">): string | null {
  if (server.status !== "approved") return "Approve the server before enabling its tools.";
  if (tool.status === "removed") return "The server no longer advertises this tool.";
  return null;
}

export interface ToolCounts {
  total: number;
  usable: number;
  unreviewed: number;
  schemaChanged: number;
  removed: number;
  disabled: number;
}

export function countTools(tools: readonly McpToolOut[], server?: Pick<McpServerOut, "status"> | null): ToolCounts {
  const c: ToolCounts = { total: tools.length, usable: 0, unreviewed: 0, schemaChanged: 0, removed: 0, disabled: 0 };
  for (const t of tools) {
    const s = reviewState(t, server);
    if (s === "usable") c.usable++;
    else if (s === "unreviewed" || s === "unknown") c.unreviewed++;
    else if (s === "schema_changed") c.schemaChanged++;
    else if (s === "removed") c.removed++;
    else c.disabled++;
  }
  return c;
}

/** Tools that need an admin decision, most serious first. */
export function toolsNeedingAttention(
  tools: readonly McpToolOut[],
  server?: Pick<McpServerOut, "status"> | null,
): McpToolOut[] {
  const rank: Partial<Record<ToolReviewState, number>> = { schema_changed: 0, unknown: 1, unreviewed: 2 };
  return tools
    .filter((t) => reviewTool(t, server).attention)
    .sort(
      (a, b) =>
        (rank[reviewState(a, server)] ?? 9) - (rank[reviewState(b, server)] ?? 9) ||
        a.qualified_name.localeCompare(b.qualified_name),
    );
}

export interface SyncGroup {
  key: "added" | "updated" | "unchanged" | "schema_changed" | "removed" | "rejected";
  label: string;
  tone: Tone;
  description: string;
  items: Array<{ name: string; reason?: string }>;
}

export function summarizeSync(result: McpSyncResult): {
  groups: SyncGroup[];
  suspicious: boolean;
  truncated: boolean;
  changed: number;
} {
  const list = (names: string[] | undefined) => (names ?? []).map((name) => ({ name }));
  const groups: SyncGroup[] = [
    {
      key: "schema_changed",
      label: "Changed since approval",
      tone: "danger",
      description: "Disabled automatically. Review and re-approve each one before agents can use it again.",
      items: list(result.schema_changed),
    },
    {
      key: "added",
      label: "New",
      tone: "warning",
      description: "Stored disabled. Review and enable the ones you need.",
      items: list(result.added),
    },
    {
      key: "updated",
      label: "Updated",
      tone: "info",
      description: "Definition refreshed (never approved, so nothing was disabled).",
      items: list(result.updated),
    },
    {
      key: "removed",
      label: "Removed",
      tone: "neutral",
      description: "No longer advertised by the server; disabled.",
      items: list(result.removed),
    },
    {
      key: "rejected",
      label: "Rejected",
      tone: "danger",
      description: "Not accepted by the gateway's safety checks.",
      items: (result.rejected ?? []).map((r) => ({ name: r.name, reason: r.reason })),
    },
    {
      key: "unchanged",
      label: "Unchanged",
      tone: "neutral",
      description: "Same definition as before.",
      items: list(result.unchanged),
    },
  ];
  const nonEmpty = groups.filter((g) => g.items.length > 0);
  const changed = nonEmpty.filter((g) => g.key !== "unchanged").reduce((n, g) => n + g.items.length, 0);
  return {
    groups: nonEmpty,
    suspicious: (result.schema_changed?.length ?? 0) > 0 || (result.rejected?.length ?? 0) > 0,
    truncated: Boolean(result.truncated),
    changed,
  };
}

/** Short display form of a sha256 hash. */
export function shortHash(hash: string | null | undefined, length = 12): string {
  return hash ? hash.slice(0, length) : "—";
}
