/**
 * Tool catalogue and policies, the Google connection (connect "completes" instantly on a local
 * route — Google is simulated), and MCP servers. Nothing here ever contacts an external system.
 */
import type { ConnectGoogleResponse, McpServerOut, McpSyncResult, ToolOut, ToolRuleOut } from "@/lib/api";
import { DEFAULT_CAPABILITIES, scopesFor } from "../../fixtures/integrations";
import { CAPABILITY_SCOPES, TOOL_CATALOGUE } from "../../fixtures/tools";
import { Body, conflict, type Ctx, json, noContent, notFound, unprocessable } from "../http";
import type { Router, Srv } from "../router";
import type { DemoStore } from "../store";
import { evaluatePermission } from "../tools";
import { clone, uuid } from "../util";
import { idempotent, requirePermission } from "./common";

const CONNECTED_URL = "/app/integrations?status=connected";

function listTools(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "tools:read");
  const builtin: ToolOut[] = TOOL_CATALOGUE.map((spec) => {
    const d = evaluatePermission(store, spec);
    return {
      name: spec.name,
      version: spec.version,
      description: spec.description,
      category: spec.category,
      provider: spec.provider,
      permission_level: spec.permission_level,
      risk_level: spec.risk_level,
      requires_approval: d.decision === "require_approval",
      required_scopes: [...spec.required_scopes],
      verification_method: spec.verification_method,
      output_trust: spec.output_trust,
      idempotency_strategy: spec.idempotency_strategy,
      timeout_seconds: spec.timeout_seconds,
      max_attempts: spec.max_attempts,
      parallel_safe: spec.parallel_safe,
      input_schema: clone(spec.input_schema),
      output_schema: clone(spec.output_schema),
      available_to_you: d.decision !== "deny",
      policy_reasons: d.reasons,
    };
  });
  const servers = new Map(store.mcpServers.map((s) => [s.id, s]));
  const mcp: ToolOut[] = store.mcpTools
    .filter((t) => t.usable && servers.get(t.server_id)?.status === "approved")
    .map((t) => ({
      name: t.qualified_name,
      version: t.schema_hash.slice(0, 12),
      description: t.description,
      category: "mcp",
      provider: `mcp:${servers.get(t.server_id)!.name}`,
      permission_level: t.permission_level,
      risk_level: t.risk_level,
      requires_approval: t.requires_approval,
      required_scopes: [],
      // Mirrors app/mcp/adapter.py: side-effecting MCP calls are never retried automatically.
      verification_method: t.permission_level === "read" ? "output_schema" : "provider_confirmation",
      output_trust: "untrusted_external_content",
      idempotency_strategy: "none",
      timeout_seconds: servers.get(t.server_id)!.timeout_seconds,
      max_attempts: t.permission_level === "read" ? 2 : 1,
      parallel_safe: t.permission_level === "read",
      input_schema: clone(t.input_schema),
      output_schema: clone(t.output_schema ?? {}),
      available_to_you: true,
      policy_reasons: t.requires_approval ? ["MCP tool configured to require approval"] : [],
    }));
  return json(
    ctx,
    200,
    [...builtin, ...mcp].sort((a, b) => (a.name < b.name ? -1 : 1)),
  );
}

/** Connecting Google in the demo: the "consent" completes immediately with the requested capabilities. */
function connectGoogle(store: DemoStore, capabilities: string[], requestId: string): ConnectGoogleResponse {
  const unknown = capabilities.filter((c) => !CAPABILITY_SCOPES[c]);
  if (unknown.length) throw unprocessable("Unknown capability", "validation_failed", { unknown });
  const now = store.nowIso();
  let conn = store.connections.find((c) => c.provider === "google");
  const requested = scopesFor(capabilities);
  const keep = conn && conn.status === "connected" ? (conn.capabilities ?? []) : [];
  const caps = [...new Set([...keep, ...capabilities])];
  if (!conn) {
    conn = {
      id: uuid(),
      provider: "google",
      status: "connected",
      account_email: "demo.user@example.com",
      connected_at: now,
      capabilities: [],
      scopes: [],
      disconnected_at: null,
      last_error_code: null,
      last_refreshed_at: null,
      token_expires_at: null,
    };
    store.connections.push(conn);
  }
  Object.assign(conn, {
    status: "connected",
    capabilities: caps,
    scopes: scopesFor(caps),
    connected_at: conn.status === "connected" ? conn.connected_at : now,
    disconnected_at: null,
    last_error_code: null,
    last_refreshed_at: now,
    token_expires_at: new Date(store.now() + 3600_000).toISOString(),
  });
  store.audit(
    {
      category: "integration",
      action: "integration.connected",
      resource_type: "connection",
      resource_id: conn.id,
      metadata: { provider: "google", capabilities: caps.length },
    },
    requestId,
  );
  return { authorization_url: CONNECTED_URL, requested_scopes: requested };
}

function findConnection(ctx: Ctx, store: DemoStore) {
  const conn = store.connections.find((c) => c.id === ctx.params.connection_id);
  if (!conn) throw notFound("Connection not found");
  return conn;
}

// ---------------------------------------------------------------------------- MCP
function findServer(ctx: Ctx, store: DemoStore): McpServerOut {
  const server = store.mcpServers.find((s) => s.id === ctx.params.server_id);
  if (!server) throw notFound("MCP server not found");
  return server;
}

async function registerServer(ctx: Ctx, srv: Srv) {
  const { store } = srv;
  requirePermission(store, "mcp:manage");
  const raw = await ctx.json();
  const b = new Body(raw).forbidExtra([
    "name",
    "url",
    "transport",
    "auth_header_name",
    "auth_header_value",
    "auth_credential_id",
    "timeout_seconds",
    "rate_limit_per_minute",
  ]);
  const name = b.str("name", { min: 2, max: 40, pattern: /^[a-z][a-z0-9_]{1,39}$/ });
  const url = b.str("url", { min: 8, max: 2000 });
  if (url && !/^https:\/\//.test(url)) b.fail("url", "Value error, the MCP endpoint must use https://");
  const authValue = b.optStr("auth_header_value", { max: 4000 });
  const authHeader = b.optStr("auth_header_name", { max: 100 });
  const timeout = b.optNum("timeout_seconds", { min: 1, max: 120 });
  const rate = b.optNum("rate_limit_per_minute", { int: true, min: 1, max: 600 });
  b.done();
  if (store.mcpServers.some((s) => s.name === name)) throw conflict("A server with this name already exists");
  const now = store.nowIso();
  const server: McpServerOut = {
    id: uuid(),
    name,
    url,
    transport: "streamable_http",
    status: "pending_review",
    has_auth: Boolean(authValue),
    auth_header_name: authValue ? (authHeader ?? "Authorization") : null,
    auth_credential_id: null,
    protocol_version: null,
    server_info: {},
    rate_limit_per_minute: rate ?? 60,
    timeout_seconds: timeout ?? 30,
    last_error: null,
    last_sync_at: null,
    approved_at: null,
    approved_by: null,
    created_by: store.me.id,
    created_at: now,
    updated_at: now,
  };
  return idempotent(ctx, srv, raw, () => {
    store.mcpServers.push(server);
    store.audit(
      { category: "admin", action: "mcp.server.register", resource_type: "mcp_server", resource_id: server.id },
      ctx.requestId,
    );
    return { status: 201, body: clone(server) };
  });
}

function syncServer(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "mcp:manage");
  const server = findServer(ctx, store);
  const tools = store.mcpTools.filter((t) => t.server_id === server.id);
  const now = store.nowIso();
  if (!tools.length) {
    // The demo never connects to external servers: report it on the server, like a failed sync.
    server.status = server.status === "disabled" ? "disabled" : "error";
    server.last_error =
      "The AgentOS demo does not connect to external MCP servers; tools are only simulated for the sample “linear” server.";
  } else {
    server.last_sync_at = now;
    server.last_error = null;
    for (const t of tools) if (t.status !== "removed") t.last_seen_at = now;
  }
  server.updated_at = now;
  const out: McpSyncResult = {
    server: clone(server),
    tools: clone(tools),
    added: [],
    removed: [],
    updated: [],
    unchanged: tools.filter((t) => t.status === "active").map((t) => t.qualified_name),
    schema_changed: tools.filter((t) => t.status === "schema_changed").map((t) => t.qualified_name),
    rejected: [],
    truncated: false,
  };
  return json(ctx, 200, out);
}

async function updateMcpTool(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "mcp:manage");
  const b = new Body(await ctx.json());
  const enabled = b.optBool("enabled");
  const requiresApproval = b.optBool("requires_approval");
  const level = b.optEnum("permission_level", [
    "read",
    "write",
    "high_risk_write",
    "destructive",
    "financial",
    "admin",
  ] as const);
  const risk = b.optEnum("risk_level", ["low", "medium", "high", "critical"] as const);
  b.done();
  const tool = store.mcpTools.find((t) => t.id === ctx.params.tool_id);
  if (!tool) throw notFound("MCP tool not found");
  const now = store.nowIso();
  if (enabled !== null) {
    tool.enabled = enabled;
    if (enabled) {
      // Enabling approves the tool's *current* schema.
      tool.approved_schema_hash = tool.schema_hash;
      tool.schema_approved = true;
      tool.approved_at = now;
      tool.approved_by = store.me.id;
      if (tool.status === "schema_changed") tool.status = "active";
    }
  }
  if (requiresApproval !== null) tool.requires_approval = requiresApproval;
  if (level) tool.permission_level = level;
  if (risk) tool.risk_level = risk;
  const server = store.mcpServers.find((s) => s.id === tool.server_id);
  tool.usable = tool.enabled && tool.status === "active" && tool.schema_approved && server?.status === "approved";
  tool.updated_at = now;
  store.audit(
    {
      category: "admin",
      action: "mcp.tool.update",
      resource_type: "mcp_tool",
      resource_id: tool.id,
      metadata: { enabled: tool.enabled },
    },
    ctx.requestId,
  );
  return json(ctx, 200, clone(tool));
}

export function integrationRoutes(r: Router): void {
  r.add("GET", "/tools", listTools)
    .add("POST", "/tools/connect", async (ctx, { store }) => {
      requirePermission(store, "integrations:manage");
      const b = new Body(await ctx.json()).forbidExtra(["provider", "capabilities"]);
      b.enumOf("provider", ["google"] as const);
      const caps = b.optStrList("capabilities", { minItems: 1 });
      if (!b.has("capabilities")) b.fail("capabilities", "Field required", "missing");
      b.done();
      return json(ctx, 200, connectGoogle(store, caps ?? [], ctx.requestId));
    })
    .add("GET", "/tools/policies", (ctx, { store }) => json(ctx, 200, clone(store.toolRules)))
    .add("POST", "/tools/policies", async (ctx, { store }) => {
      requirePermission(store, "tools:manage");
      const b = new Body(await ctx.json()).forbidExtra(["tool_pattern", "role", "effect", "reason"]);
      const pattern = b.str("tool_pattern", { min: 1, max: 128, pattern: /^[a-z0-9_.*]+$/ });
      const role = b.optStr("role", { max: 60 });
      const effect = b.enumOf("effect", ["deny", "require_approval", "allow"] as const);
      const reason = b.optStr("reason", { max: 500 });
      b.done();
      if (effect === "allow" && (pattern === "*" || pattern === "*.*")) {
        throw unprocessable("A blanket allow rule is not permitted; name the tools explicitly");
      }
      const rule: ToolRuleOut = { id: uuid(), tool_pattern: pattern, role, effect, reason };
      store.toolRules.push(rule);
      store.audit(
        {
          category: "admin",
          action: "tool_policy.create",
          resource_type: "tool_permission",
          resource_id: rule.id,
          metadata: { tool_pattern: pattern, effect, role },
        },
        ctx.requestId,
      );
      return json(ctx, 201, clone(rule));
    })
    .add("DELETE", "/tools/policies/{rule_id}", (ctx, { store }) => {
      requirePermission(store, "tools:manage");
      const rule = store.toolRules.find((x) => x.id === ctx.params.rule_id);
      if (!rule) throw notFound("Rule not found");
      store.toolRules = store.toolRules.filter((x) => x !== rule);
      store.audit(
        { category: "admin", action: "tool_policy.delete", resource_type: "tool_permission", resource_id: rule.id },
        ctx.requestId,
      );
      return noContent(ctx);
    })
    .add("GET", "/integrations", (ctx, { store }) => json(ctx, 200, clone(store.connections)))
    .add("POST", "/integrations/google/connect", async (ctx, { store }) => {
      requirePermission(store, "integrations:manage");
      const b = new Body(await ctx.json(), { optional: true });
      const caps = b.optStrList("capabilities") ?? DEFAULT_CAPABILITIES;
      b.optStr("login_hint", { max: 320 });
      b.done();
      return json(ctx, 200, connectGoogle(store, caps, ctx.requestId));
    })
    .unavailable(
      "GET",
      "/integrations/google/callback",
      "Google is simulated in the demo; connecting completes without a callback.",
    )
    .add("POST", "/integrations/{connection_id}/check", (ctx, { store }) => {
      const conn = findConnection(ctx, store);
      if (conn.status === "connected") {
        conn.last_refreshed_at = store.nowIso();
        conn.token_expires_at = new Date(store.now() + 3600_000).toISOString();
      }
      return json(ctx, 200, clone(conn));
    })
    .add("POST", "/integrations/{connection_id}/disconnect", (ctx, { store }) => {
      requirePermission(store, "integrations:manage");
      const conn = findConnection(ctx, store);
      Object.assign(conn, { status: "disconnected", disconnected_at: store.nowIso(), token_expires_at: null });
      store.audit(
        {
          category: "integration",
          action: "integration.disconnected",
          resource_type: "connection",
          resource_id: conn.id,
          metadata: { provider: conn.provider },
        },
        ctx.requestId,
      );
      return json(ctx, 200, clone(conn));
    })
    .add("GET", "/mcp/servers", (ctx, { store }) => json(ctx, 200, clone(store.mcpServers)))
    .add("POST", "/mcp/servers", registerServer)
    .add("GET", "/mcp/servers/{server_id}", (ctx, { store }) => json(ctx, 200, clone(findServer(ctx, store))))
    .add("DELETE", "/mcp/servers/{server_id}", (ctx, { store }) => {
      requirePermission(store, "mcp:manage");
      const server = findServer(ctx, store);
      store.mcpServers = store.mcpServers.filter((s) => s !== server);
      store.mcpTools = store.mcpTools.filter((t) => t.server_id !== server.id);
      store.audit(
        { category: "admin", action: "mcp.server.delete", resource_type: "mcp_server", resource_id: server.id },
        ctx.requestId,
      );
      return noContent(ctx);
    })
    .add("POST", "/mcp/servers/{server_id}/approve", (ctx, { store }) => {
      requirePermission(store, "mcp:manage");
      const server = findServer(ctx, store);
      Object.assign(server, {
        status: "approved",
        approved_at: store.nowIso(),
        approved_by: store.me.id,
        updated_at: store.nowIso(),
      });
      for (const t of store.mcpTools)
        if (t.server_id === server.id) t.usable = t.enabled && t.status === "active" && t.schema_approved;
      store.audit(
        { category: "admin", action: "mcp.server.approve", resource_type: "mcp_server", resource_id: server.id },
        ctx.requestId,
      );
      return json(ctx, 200, clone(server));
    })
    .add("POST", "/mcp/servers/{server_id}/disable", (ctx, { store }) => {
      requirePermission(store, "mcp:manage");
      const server = findServer(ctx, store);
      Object.assign(server, { status: "disabled", updated_at: store.nowIso() });
      for (const t of store.mcpTools) if (t.server_id === server.id) t.usable = false;
      store.audit(
        { category: "admin", action: "mcp.server.disable", resource_type: "mcp_server", resource_id: server.id },
        ctx.requestId,
      );
      return json(ctx, 200, clone(server));
    })
    .add("POST", "/mcp/servers/{server_id}/sync", syncServer)
    .add("GET", "/mcp/servers/{server_id}/tools", (ctx, { store }) => {
      const server = findServer(ctx, store);
      return json(ctx, 200, clone(store.mcpTools.filter((t) => t.server_id === server.id)));
    })
    .add("PATCH", "/mcp/tools/{tool_id}", updateMcpTool);
}
