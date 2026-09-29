/** Agents with immutable versions: configuration changes publish a new version that becomes current. */
import type { AgentOut, AgentVersionIn } from "@/lib/api";
import { makeVersion } from "../../fixtures/agents";
import { Body, conflict, type Ctx, json, noContent, notFound, paginate } from "../http";
import type { Router, Srv } from "../router";
import type { AgentRec, DemoStore } from "../store";
import { clone, uuid } from "../util";
import { requirePermission } from "./common";

const VERSION_FIELDS = [
  "instructions",
  "model_policy",
  "tool_policy",
  "memory_policy",
  "execution_limits",
  "verification_policy",
];

function agentOut(store: DemoStore, a: AgentRec): AgentOut {
  const version = store.agentVersions.find((v) => v.id === a.current_version_id) ?? null;
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    status: a.status,
    current_version_id: a.current_version_id,
    current_version: clone(version),
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

function findAgent(ctx: Ctx, store: DemoStore): AgentRec {
  const agent = store.agents.find((a) => a.id === ctx.params.agent_id && !a.deleted);
  if (!agent) throw notFound("Agent not found");
  return agent;
}

/** Validates an AgentVersionIn body (extra fields forbidden, like the backend's pydantic models). */
function versionBody(b: Body): AgentVersionIn {
  const instructions = b.optStr("instructions", { max: 20_000 }) ?? "";
  const nested = (field: string, allowed: string[]) => {
    const v = b.optObj(field);
    for (const key of Object.keys(v ?? {}))
      if (!allowed.includes(key)) b.fail(`${field}.${key}`, "Extra inputs are not permitted", "extra_forbidden");
    return v ?? undefined;
  };
  const tool = nested("tool_policy", ["allowed", "denied"]);
  for (const k of ["allowed", "denied"]) {
    const list = tool?.[k];
    if (list !== undefined && (!Array.isArray(list) || list.some((x) => typeof x !== "string")))
      b.fail(`tool_policy.${k}`, "Input should be a valid list", "list_type");
  }
  const model = nested("model_policy", ["default", "fast", "reasoning", "fallbacks", "planning_tier"]);
  if (model?.planning_tier !== undefined && !["fast", "default", "reasoning"].includes(String(model.planning_tier))) {
    b.fail(
      "model_policy.planning_tier",
      "String should match pattern '^(fast|default|reasoning)$'",
      "string_pattern_mismatch",
    );
  }
  const memory = nested("memory_policy", ["enabled", "max_items", "extract_after_task"]);
  const limits = nested("execution_limits", [
    "max_steps",
    "max_tool_calls",
    "max_model_calls",
    "max_duration_seconds",
    "max_cost_usd",
    "max_browser_actions",
  ]);
  const verification = nested("verification_policy", ["readback_attempts", "readback_delay_ms"]);
  const attempts = verification?.readback_attempts;
  if (attempts !== undefined && (typeof attempts !== "number" || attempts < 1 || attempts > 10)) {
    b.fail("verification_policy.readback_attempts", "Input should be between 1 and 10", "less_than_equal");
  }
  return {
    instructions,
    tool_policy: tool,
    model_policy: model,
    memory_policy: memory,
    execution_limits: limits,
    verification_policy: verification,
  } as AgentVersionIn;
}

async function createAgent(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "agents:manage");
  const b = new Body(await ctx.json()).forbidExtra(["name", "description", ...VERSION_FIELDS]);
  const name = b.str("name", { min: 1, max: 120 });
  const description = b.optStr("description", { max: 2000 });
  const version = versionBody(b);
  b.done();
  if (store.agents.some((a) => a.name === name && !a.deleted)) throw conflict("An agent with this name already exists");
  const now = store.nowIso();
  const agent: AgentRec = {
    id: uuid(),
    name,
    description,
    status: "active",
    created_at: now,
    updated_at: now,
    current_version_id: null,
    deleted: false,
  };
  const v = makeVersion(agent.id, 1, version, now);
  agent.current_version_id = v.id;
  store.agents.push(agent);
  store.agentVersions.push(v);
  store.audit(
    { category: "admin", action: "agent.create", resource_type: "agent", resource_id: agent.id },
    ctx.requestId,
  );
  return json(ctx, 201, agentOut(store, agent));
}

async function updateAgent(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "agents:manage");
  const b = new Body(await ctx.json());
  const description = b.optStr("description", { max: 2000 });
  const status = b.optStr("status", { pattern: /^(active|disabled)$/ });
  b.done();
  const agent = findAgent(ctx, store);
  if (b.has("description")) agent.description = description;
  if (status) agent.status = status;
  agent.updated_at = store.nowIso();
  store.audit(
    { category: "admin", action: "agent.update", resource_type: "agent", resource_id: agent.id },
    ctx.requestId,
  );
  return json(ctx, 200, agentOut(store, agent));
}

async function addVersion(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "agents:manage");
  const b = new Body(await ctx.json(), { optional: true }).forbidExtra(VERSION_FIELDS);
  const body = versionBody(b);
  b.done();
  const agent = findAgent(ctx, store);
  const number =
    Math.max(0, ...store.agentVersions.filter((v) => v.agent_id === agent.id).map((v) => v.version_number)) + 1;
  const v = makeVersion(agent.id, number, body, store.nowIso());
  store.agentVersions.push(v);
  agent.current_version_id = v.id;
  agent.updated_at = v.created_at;
  store.audit(
    {
      category: "admin",
      action: "agent.version.create",
      resource_type: "agent",
      resource_id: agent.id,
      metadata: { version_number: number },
    },
    ctx.requestId,
  );
  return json(ctx, 201, clone(v));
}

export function agentRoutes(r: Router): void {
  r.add("GET", "/agents", (ctx, { store }) =>
    json(
      ctx,
      200,
      paginate(
        ctx,
        store.agents.filter((a) => !a.deleted),
        (a) => agentOut(store, a),
      ),
    ),
  )
    .add("POST", "/agents", createAgent)
    .add("GET", "/agents/{agent_id}", (ctx, { store }) => json(ctx, 200, agentOut(store, findAgent(ctx, store))))
    .add("PATCH", "/agents/{agent_id}", updateAgent)
    .add("DELETE", "/agents/{agent_id}", (ctx, { store }) => {
      requirePermission(store, "agents:manage");
      const agent = findAgent(ctx, store);
      agent.deleted = true;
      agent.status = "disabled";
      store.audit(
        { category: "admin", action: "agent.delete", resource_type: "agent", resource_id: agent.id },
        ctx.requestId,
      );
      return noContent(ctx);
    })
    .add("GET", "/agents/{agent_id}/versions", (ctx, { store }) => {
      const agent = findAgent(ctx, store);
      const versions = store.agentVersions
        .filter((v) => v.agent_id === agent.id)
        .sort((a, b) => b.version_number - a.version_number);
      return json(ctx, 200, clone(versions));
    })
    .add("POST", "/agents/{agent_id}/versions", addVersion);
}
