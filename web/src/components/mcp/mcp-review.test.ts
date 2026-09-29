import { describe, expect, it } from "vitest";
import type { McpSyncResult, McpToolOut } from "@/lib/api";
import { countTools, enableBlockedReason, reviewTool, summarizeSync, toolsNeedingAttention } from "./mcp-review";
import { registerServerDefaults, registerServerSchema, toRegisterPayload } from "./register-schema";

function tool(patch: Partial<McpToolOut> = {}): McpToolOut {
  return {
    id: "t1",
    server_id: "s1",
    remote_name: "echo",
    qualified_name: "mcp.demo.echo",
    title: "Echo",
    description: "Return the text.",
    input_schema: { type: "object" },
    output_schema: null,
    annotations: {},
    schema_hash: "h2",
    approved_schema_hash: "h2",
    schema_approved: true,
    permission_level: "read",
    risk_level: "low",
    requires_approval: false,
    enabled: true,
    status: "active",
    usable: true,
    approved_by: null,
    approved_at: null,
    last_seen_at: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...patch,
  };
}

const approved = { status: "approved" };

describe("reviewTool", () => {
  it("usable tools are enabled and need nothing", () => {
    expect(reviewTool(tool(), approved)).toMatchObject({ state: "usable", attention: false, requiresReview: false });
  });

  it("newly discovered tools (no approved hash) need review", () => {
    const r = reviewTool(tool({ approved_schema_hash: null, schema_approved: false, enabled: false, usable: false }), approved);
    expect(r).toMatchObject({ state: "unreviewed", tone: "warning", attention: true, requiresReview: true });
  });

  it("flags tools whose definition changed after approval (backend status)", () => {
    const r = reviewTool(
      tool({ status: "schema_changed", approved_schema_hash: "h1", schema_approved: false, enabled: false, usable: false }),
      approved,
    );
    expect(r).toMatchObject({ state: "schema_changed", tone: "danger", attention: true, requiresReview: true });
  });

  it("flags a hash mismatch even if the status still says active", () => {
    const r = reviewTool(tool({ approved_schema_hash: "h1", schema_approved: false, usable: false }), approved);
    expect(r.state).toBe("schema_changed");
  });

  it("removed tools are informational and cannot be enabled", () => {
    const t = tool({ status: "removed", enabled: false, usable: false });
    expect(reviewTool(t, approved)).toMatchObject({ state: "removed", attention: false });
    expect(enableBlockedReason(t, approved)).toMatch(/no longer advertises/);
  });

  it("approved but switched-off tools are simply disabled", () => {
    expect(reviewTool(tool({ enabled: false, usable: false }), approved).state).toBe("disabled");
  });

  it("an enabled tool on an unapproved server is not usable", () => {
    const t = tool({ usable: false });
    expect(reviewTool(t, { status: "disabled" }).state).toBe("server_blocked");
    expect(enableBlockedReason(t, { status: "pending_review" })).toMatch(/Approve the server/);
    expect(enableBlockedReason(t, approved)).toBeNull();
  });

  it("unknown statuses demand attention rather than looking healthy", () => {
    expect(reviewTool(tool({ status: "quarantined", usable: false }), approved)).toMatchObject({ state: "unknown", attention: true });
  });
});

describe("counts and attention ordering", () => {
  const tools = [
    tool({ id: "a", qualified_name: "mcp.demo.a" }),
    tool({ id: "b", qualified_name: "mcp.demo.b", approved_schema_hash: null, enabled: false, usable: false }),
    tool({ id: "c", qualified_name: "mcp.demo.c", status: "schema_changed", approved_schema_hash: "h0", enabled: false, usable: false }),
    tool({ id: "d", qualified_name: "mcp.demo.d", status: "removed", enabled: false, usable: false }),
    tool({ id: "e", qualified_name: "mcp.demo.e", enabled: false, usable: false }),
  ];

  it("counts tools per review state", () => {
    expect(countTools(tools, approved)).toEqual({ total: 5, usable: 1, unreviewed: 1, schemaChanged: 1, removed: 1, disabled: 1 });
  });

  it("lists changed tools before unreviewed ones", () => {
    expect(toolsNeedingAttention(tools, approved).map((t) => t.id)).toEqual(["c", "b"]);
  });
});

describe("summarizeSync", () => {
  const server = {} as McpSyncResult["server"];

  it("marks schema changes and rejections as suspicious", () => {
    const s = summarizeSync({ server, added: ["mcp.demo.x"], schema_changed: ["mcp.demo.echo"], unchanged: ["mcp.demo.y"], rejected: [] });
    expect(s.suspicious).toBe(true);
    expect(s.groups.map((g) => g.key)).toEqual(["schema_changed", "added", "unchanged"]);
    expect(s.changed).toBe(2);
  });

  it("a clean sync is not suspicious", () => {
    const s = summarizeSync({ server, unchanged: ["a", "b"], truncated: false });
    expect(s).toMatchObject({ suspicious: false, truncated: false, changed: 0 });
  });

  it("carries rejection reasons", () => {
    const s = summarizeSync({ server, rejected: [{ name: "bad tool", reason: "tool name must be 1-128 characters" }] });
    expect(s.suspicious).toBe(true);
    expect(s.groups[0].items[0]).toEqual({ name: "bad tool", reason: "tool name must be 1-128 characters" });
  });
});

describe("register server form", () => {
  const parse = (patch: Partial<typeof registerServerDefaults>) =>
    registerServerSchema.safeParse({ ...registerServerDefaults, name: "demo", url: "https://mcp.example.com/mcp", ...patch });

  it("accepts a minimal registration and omits auth when no secret is given", () => {
    const r = parse({});
    expect(r.success).toBe(true);
    expect(toRegisterPayload(r.data!)).toEqual({ name: "demo", url: "https://mcp.example.com/mcp", transport: "streamable_http", rate_limit_per_minute: 60 });
  });

  it("sends the auth header only with a value, plus an explicit timeout", () => {
    const r = parse({ authHeaderValue: "Bearer s3cret", authHeaderName: "X-Api-Key", timeoutSeconds: "15" });
    expect(toRegisterPayload(r.data!)).toMatchObject({ auth_header_name: "X-Api-Key", auth_header_value: "Bearer s3cret", timeout_seconds: 15 });
  });

  it("mirrors backend validation", () => {
    expect(parse({ name: "Demo" }).success).toBe(false);
    expect(parse({ name: "d" }).success).toBe(false);
    expect(parse({ url: "ftp://x.example.com/mcp" }).success).toBe(false);
    expect(parse({ url: "https://x.example.com/mcp#frag" }).success).toBe(false);
    expect(parse({ authHeaderName: "Cookie" }).success).toBe(false);
    expect(parse({ authHeaderValue: "Bearer a\nb" }).success).toBe(false);
    expect(parse({ timeoutSeconds: "0.4" }).success).toBe(false);
    expect(parse({ rateLimitPerMinute: "601" }).success).toBe(false);
  });
});
