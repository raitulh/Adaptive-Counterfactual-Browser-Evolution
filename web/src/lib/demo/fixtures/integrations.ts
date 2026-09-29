/** Google connection, organization tool rules, and an MCP server with tools (plus one awaiting review). */
import type { McpToolOut } from "@/lib/api";
import type { DemoStore } from "../server/store";
import { DAY, hash64, HOUR, iso, MINUTE, seedId } from "../server/util";
import { CAPABILITY_SCOPES } from "./tools";

export const GOOGLE_CONNECTION_ID = seedId(0x20, 1);
export const MCP_SERVER_IDS = { linear: seedId(0x21, 1), wiki: seedId(0x21, 2) };

export const DEFAULT_CAPABILITIES = [
  "gmail.read",
  "gmail.compose",
  "gmail.send",
  "calendar.read",
  "calendar.write",
  "contacts.read",
];

export function scopesFor(capabilities: string[]): string[] {
  return [...new Set(capabilities.flatMap((c) => CAPABILITY_SCOPES[c] ?? []))];
}

export function seedIntegrations(store: DemoStore, now: number): void {
  store.connections = [
    {
      id: GOOGLE_CONNECTION_ID,
      provider: "google",
      status: "connected",
      account_email: "demo.user@example.com",
      capabilities: [...DEFAULT_CAPABILITIES],
      scopes: scopesFor(DEFAULT_CAPABILITIES),
      connected_at: iso(now - 58 * DAY),
      last_refreshed_at: iso(now - 17 * MINUTE),
      token_expires_at: iso(now + 43 * MINUTE),
      disconnected_at: null,
      last_error_code: null,
    },
  ];

  store.toolRules = [
    {
      id: seedId(0x22, 1),
      tool_pattern: "gmail.send",
      effect: "require_approval",
      role: null,
      reason: "External e-mail always needs a human decision.",
    },
    {
      id: seedId(0x22, 2),
      tool_pattern: "calendar.cancel_event",
      effect: "deny",
      role: "member",
      reason: "Only admins may cancel events on behalf of others.",
    },
    {
      id: seedId(0x22, 3),
      tool_pattern: "memory.save",
      effect: "allow",
      role: null,
      reason: "Saving memories needs no approval.",
    },
  ];

  const approvedAt = iso(now - 19 * DAY);
  store.mcpServers = [
    {
      id: MCP_SERVER_IDS.linear,
      name: "linear",
      url: "https://mcp.linear.example.com/mcp",
      transport: "streamable_http",
      status: "approved",
      has_auth: true,
      auth_header_name: "Authorization",
      auth_credential_id: null,
      protocol_version: "2025-06-18",
      server_info: { name: "Linear MCP", version: "1.4.2" },
      rate_limit_per_minute: 60,
      timeout_seconds: 30,
      last_error: null,
      last_sync_at: iso(now - 2 * HOUR),
      approved_at: approvedAt,
      approved_by: store.me.id,
      created_by: store.me.id,
      created_at: iso(now - 20 * DAY),
      updated_at: iso(now - 2 * HOUR),
    },
    {
      id: MCP_SERVER_IDS.wiki,
      name: "internal_wiki",
      url: "https://wiki.agentos.example.com/mcp",
      transport: "streamable_http",
      status: "pending_review",
      has_auth: false,
      auth_header_name: null,
      auth_credential_id: null,
      protocol_version: null,
      server_info: {},
      rate_limit_per_minute: 30,
      timeout_seconds: 20,
      last_error: null,
      last_sync_at: null,
      approved_at: null,
      approved_by: null,
      created_by: store.members[1]?.user_id ?? store.me.id,
      created_at: iso(now - 26 * HOUR),
      updated_at: iso(now - 26 * HOUR),
    },
  ];

  const tool = (
    n: number,
    remote: string,
    title: string,
    description: string,
    level: McpToolOut["permission_level"],
    risk: McpToolOut["risk_level"],
    extra: Partial<McpToolOut> = {},
  ): McpToolOut => {
    const input_schema = { type: "object", properties: { title: { type: "string" }, team: { type: "string" } } };
    const hash = hash64(`${remote}:${JSON.stringify(input_schema)}`);
    return {
      id: seedId(0x23, n),
      server_id: MCP_SERVER_IDS.linear,
      remote_name: remote,
      qualified_name: `mcp.linear.${remote}`,
      title,
      description,
      input_schema,
      output_schema: null,
      annotations: level === "read" ? { readOnlyHint: true } : { destructiveHint: level === "destructive" },
      permission_level: level,
      risk_level: risk,
      requires_approval: level !== "read",
      enabled: true,
      status: "active",
      schema_hash: hash,
      approved_schema_hash: hash,
      schema_approved: true,
      approved_at: approvedAt,
      approved_by: store.me.id,
      last_seen_at: iso(now - 2 * HOUR),
      created_at: iso(now - 20 * DAY),
      updated_at: iso(now - 2 * HOUR),
      usable: true,
      ...extra,
    };
  };
  store.mcpTools = [
    tool(1, "search_issues", "Search issues", "Search Linear issues by text, team or state.", "read", "low"),
    tool(2, "create_issue", "Create issue", "Create a Linear issue in a team.", "write", "medium"),
    tool(3, "update_issue", "Update issue", "Change an issue's title, state or assignee.", "write", "medium", {
      status: "schema_changed",
      enabled: false,
      usable: false,
      schema_approved: false,
      schema_hash: hash64("update_issue:v2"),
    }),
    tool(4, "delete_issue", "Delete issue", "Permanently delete an issue.", "destructive", "high", {
      enabled: false,
      usable: false,
    }),
  ];
}
