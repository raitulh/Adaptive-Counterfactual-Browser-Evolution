/**
 * Contract-level tests of the in-browser demo backend through the real API layer: auth/session,
 * error envelope, pagination, Idempotency-Key replay, SSE resume, 501s and state-changing mutations.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 20_000 });

vi.mock("@/lib/config/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/config/env")>();
  return { env: { ...mod.env, demoMode: true } };
});

import {
  acbeApi,
  agentsApi,
  AgentOSApiError,
  approvalsApi,
  auditApi,
  authApi,
  automationsApi,
  billingApi,
  evaluationsApi,
  experimentsApi,
  filesApi,
  mcpApi,
  memoryApi,
  newIdempotencyKey,
  notificationsApi,
  organizationsApi,
  refreshSession,
  sessionStore,
  tasksApi,
  toolsApi,
  usageApi,
  usersApi,
} from "@/lib/api";
import { adoptBodyRefreshToken } from "@/lib/api/session";
import { parseTaskEvent } from "@/lib/realtime/events";
import { SseParser, type SseEvent } from "@/lib/realtime/sse";
import { configureDemo } from "@/lib/demo/backend";
import { closeStreams, freshDemo, listen, multipart, raw, until } from "./demo-helpers";

beforeEach(() => freshDemo());
afterEach(() => closeStreams());

const apiError = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e as AgentOSApiError,
  );

describe("auth and session", () => {
  it("the demo user is always signed in: refresh works without cookies and /users/me is the owner", async () => {
    const session = await refreshSession();
    expect(session?.accessToken).toMatch(/^demo-at\./);
    const me = await usersApi.me();
    expect(me).toMatchObject({
      email: "demo@agentos.example.com",
      display_name: "Demo User",
      role: "owner",
      is_platform_admin: false,
    });
    expect(me.permissions).toHaveLength(24);
    expect(sessionStore.get()?.tenantId).toBe(me.tenant_id);
  });

  it("login (cookie delivery) and register (body delivery + exchange) return the demo session", async () => {
    const login = await authApi.login({ email: "anyone@example.com", password: "whatever" });
    expect(login.refresh_token).toBeNull();
    expect(document.cookie).toContain("agentos_csrf=");
    const reg = await authApi.register({ email: "new@example.com", password: "Correct-Horse-9" });
    expect(reg.refresh_token).toMatch(/^demo-rt\./);
    const adopted = await adoptBodyRefreshToken(reg.refresh_token!);
    expect(adopted.userId).toBe(reg.user_id);
    // Refresh tokens rotate: reusing one is rejected.
    const reused = await raw("/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: reg.refresh_token }),
    });
    expect(reused.status).toBe(401);
    const weak = await apiError(authApi.register({ email: "new@example.com", password: "short" }));
    expect(weak?.status).toBe(422);
    expect(weak?.fieldErrors.password).toMatch(/at least 10/);
  });

  it("logout signs out (401s) until the next login", async () => {
    await usersApi.me();
    await authApi.logout();
    sessionStore.clear();
    const denied = await apiError(usersApi.me());
    expect(denied?.status).toBe(401);
    expect(await refreshSession()).toBeNull();
    await authApi
      .login({ email: "demo@agentos.example.com", password: "x" })
      .then((t) =>
        sessionStore.set({
          accessToken: t.access_token,
          expiresAt: Date.now() + 900_000,
          sessionId: t.session_id,
          tenantId: t.tenant_id,
          userId: t.user_id,
        }),
      );
    expect((await usersApi.me()).email).toBe("demo@agentos.example.com");
  });

  it("Google sign-in and Google connect stay local (no external navigation)", async () => {
    const start = await authApi.googleStart();
    const url = new URL(start.authorization_url, "http://localhost:3000");
    expect(url.pathname).toBe("/callback/google");
    const token = await authApi.googleCallback(url.searchParams.get("code")!, url.searchParams.get("state")!);
    expect(token.access_token).toMatch(/^demo-at\./);
    const replay = await apiError(authApi.googleCallback("demo-google-code", url.searchParams.get("state")!));
    expect(replay?.status).toBe(401); // single-use state
    const tools = await toolsApi.connect({ provider: "google", capabilities: ["drive.read"] });
    expect(tools.authorization_url).toBe("/app/integrations?status=connected");
    const [google] = await (await import("@/lib/api")).integrationsApi.list();
    expect(google.capabilities).toContain("drive.read");
  });
});

describe("contract: errors, 501s and pagination", () => {
  it("unimplemented contract endpoints answer 501 not_available_in_demo in the error envelope", async () => {
    for (const [method, path] of [
      ["GET", "/admin/system"],
      ["POST", "/search/web"],
      ["POST", "/auth/mfa/enroll"],
      ["DELETE", "/users/me"],
      ["POST", "/organizations"],
    ]) {
      const res = await raw(path, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "GET" ? undefined : "{}",
      });
      expect(res.status, `${method} ${path}`).toBe(501);
      const body = (await res.json()) as {
        error: { code: string; message: string; request_id: string; details: object };
      };
      expect(body.error.code).toBe("not_available_in_demo");
      expect(body.error.request_id).toBe(res.headers.get("x-request-id"));
      expect(body.error.details).toEqual({});
    }
    const err = await apiError((await import("@/lib/api")).searchApi.web({ query: "agents" }));
    expect(err).toMatchObject({ status: 501, code: "not_available_in_demo" });
  });

  it("unknown paths 404, wrong methods 405, malformed UUIDs and bodies 422", async () => {
    expect((await raw("/nope")).status).toBe(404);
    expect((await raw("/tasks", { method: "DELETE" })).status).toBe(405);
    const badId = await raw("/tasks/not-a-uuid");
    expect(badId.status).toBe(422);
    expect(await badId.json()).toMatchObject({
      error: { code: "validation_failed", details: { errors: [{ loc: ["path", "task_id"], type: "uuid_parsing" }] } },
    });
    const missing = await apiError(tasksApi.get("00000000-0000-4000-8000-000000000000"));
    expect(missing).toMatchObject({ status: 404, code: "not_found", message: "Task not found" });
    const invalid = await apiError(tasksApi.create({ goal: "", priority: 5000 }, newIdempotencyKey()));
    expect(invalid?.status).toBe(422);
    expect(invalid?.fieldErrors).toMatchObject({
      goal: expect.stringMatching(/at least 1/),
      priority: expect.stringMatching(/less than or equal to 1000/),
    });
    const extra = await raw("/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: "x y z", surprise: 1 }),
    });
    expect((await extra.json()) as object).toMatchObject({
      error: { details: { errors: [{ loc: ["body", "surprise"], type: "extra_forbidden" }] } },
    });
  });

  it("keyset pagination: newest first, opaque cursor, no overlap, validated limit/cursor", async () => {
    const first = await tasksApi.list({ limit: 4 });
    expect(first.items).toHaveLength(4);
    expect(first.has_more).toBe(true);
    const seen = new Set(first.items.map((t) => t.task_id));
    let cursor = first.next_cursor;
    let total = first.items.length;
    while (cursor) {
      const page = await tasksApi.list({ limit: 4, cursor });
      for (const t of page.items) expect(seen.has(t.task_id)).toBe(false);
      page.items.forEach((t) => seen.add(t.task_id));
      total += page.items.length;
      cursor = page.next_cursor ?? null;
      if (!page.has_more) expect(cursor).toBeNull();
    }
    expect(total).toBe(11); // the teammate's task is only visible with all_users
    expect((await tasksApi.list({ all_users: true, limit: 200 })).items).toHaveLength(12);
    const created = first.items.map((t) => t.created_at);
    expect([...created].sort().reverse()).toEqual(created);
    expect((await apiError(tasksApi.list({ limit: 0 })))?.status).toBe(422);
    expect((await apiError(tasksApi.list({ cursor: "garbage!" })))?.details).toEqual({ cursor: "malformed" });
    const waiting = await tasksApi.list({ status: "waiting_input" });
    expect(waiting.items.map((t) => t.status)).toEqual(["waiting_input"]);
  });
});

describe("Idempotency-Key", () => {
  it("POST /tasks: same key → same task (replayed); same key, different body → 422", async () => {
    const key = newIdempotencyKey();
    const a = await tasksApi.create({ goal: "Summarize my unread emails" }, key);
    const replay = await raw("/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ goal: "Summarize my unread emails" }),
    });
    expect(replay.status).toBe(202);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(((await replay.json()) as { task_id: string }).task_id).toBe(a.task_id);
    const b = await tasksApi.create({ goal: "Summarize my unread emails" }, key);
    expect(b.task_id).toBe(a.task_id);
    const other = await apiError(tasksApi.create({ goal: "Something else" }, key));
    expect(other).toMatchObject({ status: 422, code: "idempotency_key_reused" });
    expect((await tasksApi.list({ limit: 200 })).items.filter((t) => t.task_id === a.task_id)).toHaveLength(1);
  });

  it("approvals: retrying with the same key replays; a new decision on a decided approval is 409", async () => {
    const [pending] = (await approvalsApi.list({ status: "pending" })).items;
    const key = newIdempotencyKey();
    const first = await approvalsApi.approve(pending.id, key);
    const again = await approvalsApi.approve(pending.id, key);
    expect(again).toEqual(first);
    const second = await apiError(approvalsApi.approve(pending.id, newIdempotencyKey()));
    expect(second).toMatchObject({ status: 409, code: "approval_not_pending" });
  });
});

describe("SSE", () => {
  async function readStream(
    res: Response,
    until: (events: SseEvent[]) => boolean,
  ): Promise<{ events: SseEvent[]; comments: string[] }> {
    const events: SseEvent[] = [];
    const comments: string[] = [];
    const parser = new SseParser((e) => events.push(e));
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    while (!until(events)) {
      const { value, done } = await reader.read();
      if (done) break;
      comments.push(...value.split("\n").filter((l) => l.startsWith(":")));
      parser.push(value);
    }
    await reader.cancel();
    return { events, comments };
  }

  it("task stream honours Last-Event-ID and ends with `event: end` for final tasks", async () => {
    const completed = (await tasksApi.list({ status: "completed", limit: 1 })).items[0];
    const history = await tasksApi.eventsAfter(completed.task_id);
    const { token } = await authApi.streamToken();
    const res = await raw(`/tasks/${completed.task_id}/events/stream?access_token=${token}`, {
      headers: { "last-event-id": String(history.length - 3) },
    });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const { events, comments } = await readStream(res, (e) => e.some((x) => x.event === "end"));
    expect(comments[0]).toBe(": connected");
    expect(events.map((e) => e.id)).toEqual([
      ...history.slice(-3).map((e) => String(e.seq)),
      String(history.at(-1)!.seq),
    ]);
    expect(events.slice(0, 3).map((e) => parseTaskEvent(e.event, e.data))).toEqual(
      history.slice(-3).map((e) => ({ ...e, task_id: completed.task_id })),
    );
    expect(events.at(-1)).toMatchObject({ event: "end" });
  });

  it("requires a valid stream token and sends keep-alives while idle", async () => {
    const waiting = (await tasksApi.list({ status: "waiting_input" })).items[0];
    expect((await raw(`/tasks/${waiting.task_id}/events/stream`)).status).toBe(401);
    expect((await raw(`/events/stream?access_token=forged`)).status).toBe(401);
    const { token } = await authApi.streamToken();
    const controller = new AbortController();
    const res = await raw(`/tasks/${waiting.task_id}/events/stream?access_token=${token}`, {
      signal: controller.signal,
    });
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    while (!text.includes(": keep-alive")) text += (await reader.read()).value ?? "";
    expect(text).toMatch(/^: connected\n\nid: 1\nevent: TASK_CREATED\ndata: \{/);
    controller.abort();
    await expect(reader.read()).resolves.toMatchObject({ done: true });
  });

  it("the SSE client resumes after its last event id (no duplicates)", async () => {
    const task = await tasksApi.create({ goal: "What is AgentOS?" }, newIdempotencyKey());
    await until(async () => (await tasksApi.get(task.task_id)).status === "completed");
    const all = await tasksApi.eventsAfter(task.task_id);
    const stream = listen(`/tasks/${task.task_id}/events/stream`, String(all.length - 2));
    await until(() => stream.states.includes("ended"));
    expect(stream.events.map((e) => e.event)).toEqual([...all.slice(-2).map((e) => e.event_type), "end"]);
  });
});

describe("mutations change state", () => {
  it("agents: create → listed; new version becomes current; duplicate names 409", async () => {
    const agent = await agentsApi.create({
      name: "Travel Planner",
      description: "Plans trips",
      tool_policy: { allowed: ["calendar.*"], denied: [] },
    });
    expect(agent.current_version).toMatchObject({
      version_number: 1,
      tool_policy: { allowed: ["calendar.*"], denied: [] },
    });
    expect((await agentsApi.list()).items[0].id).toBe(agent.id);
    const v2 = await agentsApi.createVersion(agent.id, { instructions: "Prefer trains." });
    expect(v2.version_number).toBe(2);
    expect(v2.checksum).not.toBe(agent.current_version!.checksum);
    expect((await agentsApi.get(agent.id)).current_version_id).toBe(v2.id);
    expect((await agentsApi.versions(agent.id)).map((v) => v.version_number)).toEqual([2, 1]);
    expect((await apiError(agentsApi.create({ name: "Travel Planner" })))?.status).toBe(409);
    await agentsApi.remove(agent.id);
    expect((await apiError(agentsApi.get(agent.id)))?.status).toBe(404);
  });

  it("an agent's tool policy is enforced at planning time (blocked with PLAN_REJECTED)", async () => {
    const triage = (await agentsApi.list()).items.find((a) => a.name === "Inbox Triage")!;
    const task = await tasksApi.create(
      { goal: "Schedule a meeting with Rahim tomorrow", agent_id: triage.id },
      newIdempotencyKey(),
    );
    await until(async () => (await tasksApi.get(task.task_id)).status === "blocked");
    const detail = await tasksApi.get(task.task_id);
    expect(detail.failure_code).toBe("policy_denied");
    expect((await tasksApi.eventsAfter(task.task_id)).some((e) => e.event_type === "PLAN_REJECTED")).toBe(true);
  });

  it("notifications: mark one read → unread count drops; mark all read → zero", async () => {
    const unread = await notificationsApi.list({ unread_only: true });
    expect(unread.items.length).toBeGreaterThanOrEqual(3);
    await notificationsApi.markRead(unread.items[0].id);
    expect((await notificationsApi.list({ unread_only: true })).items).toHaveLength(unread.items.length - 1);
    await notificationsApi.markAllRead();
    expect((await notificationsApi.list({ unread_only: true })).items).toHaveLength(0);
  });

  it("files: multipart upload → uploaded → processing → ready; download URL never leaves the browser", async () => {
    configureDemo({ timeScale: 0.2 }); // slow enough to observe the intermediate "processing" state
    const { body, headers } = multipart({
      file: { filename: "launch-notes.md", type: "text/markdown", content: "# Launch\n\nShip on October 14.\n" },
      purpose: "user_upload",
    });
    const res = await raw("/files", { method: "POST", body, headers: { ...headers, "idempotency-key": "upload-1" } });
    expect(res.status).toBe(201);
    const file = (await res.json()) as { id: string; status: string; sha256: string; content_type: string };
    expect(file).toMatchObject({ status: "uploaded", content_type: "text/markdown" });
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    await until(async () => (await filesApi.get(file.id)).status === "processing");
    const ready = await until(async () => {
      const f = await filesApi.get(file.id);
      return f.status === "ready" ? f : null;
    });
    expect(ready.metadata).toMatchObject({ extraction_status: "completed", chunk_count: 1 });
    const link = await filesApi.downloadUrl(file.id);
    expect(link.url).toMatch(/^(blob:|data:)/);
    const hits = await (await import("@/lib/api")).searchApi.documents({ query: "October launch" });
    expect(hits.results[0]).toMatchObject({ title: expect.any(String), source_type: "file" });
    await filesApi.remove(file.id);
    expect((await apiError(filesApi.get(file.id)))?.status).toBe(404);
  });

  it("memory: create (supersedes same subject), search, verify, delete", async () => {
    const created = await memoryApi.create({
      content: "Prefers 45-minute meetings.",
      memory_type: "preference",
      subject_key: "pref:meeting_time",
    });
    expect(created).toMatchObject({ confidence: 1, source_type: "user_stated", freshness: "fresh" });
    const superseded = await memoryApi.list({ status: "superseded" });
    expect(superseded.items.some((m) => m.superseded_by === created.id)).toBe(true);
    const found = await memoryApi.search({ query: "meetings" });
    expect(found.results.map((r) => r.id)).toContain(created.id);
    const conflicted = (await memoryApi.list({ status: "conflicted" })).items[0];
    expect(conflicted.freshness).toBe("unverified");
    const verified = await memoryApi.verify(conflicted.id);
    expect(verified).toMatchObject({ status: "active", freshness: "fresh" });
    await memoryApi.remove(created.id);
    expect((await memoryApi.list({ limit: 200 })).items.some((m) => m.id === created.id)).toBe(false);
  });

  it("automations: create validates cron; run-now creates a task and the run settles", async () => {
    const bad = await apiError(
      automationsApi.create({ name: "Too often", cron_expression: "*/5 * * * *", task_template: { goal: "x" } }),
    );
    expect(bad?.fieldErrors.cron_expression).toMatch(/15 minutes/);
    const auto = await automationsApi.create({
      name: "Daily inbox",
      cron_expression: "0 9 * * *",
      timezone: "Europe/Berlin",
      task_template: { goal: "Summarize my unread emails" },
    });
    expect(auto.next_run_at).not.toBeNull();
    expect((await automationsApi.list()).items[0].id).toBe(auto.id);
    const run = await automationsApi.runNow(auto.id);
    expect(run).toMatchObject({ trigger: "manual", status: "created" });
    await until(async () => (await automationsApi.runs(auto.id)).items[0].status === "succeeded");
    const task = await tasksApi.get(run.task_id!);
    expect(task.status).toBe("completed");
    const stale = await apiError(automationsApi.update(auto.id, { enabled: false, expected_version: 99 }));
    expect(stale).toMatchObject({ status: 409, code: "version_conflict" });
  });

  it("tool policies, org policy, members, MCP, usage, audit and billing", async () => {
    const rule = await toolsApi.createPolicy({
      tool_pattern: "gmail.create_draft",
      effect: "deny",
      reason: "No drafts today",
    });
    const tools = await toolsApi.list();
    expect(tools.find((t) => t.name === "gmail.create_draft")).toMatchObject({
      available_to_you: false,
      policy_reasons: ["No drafts today"],
    });
    expect(tools.find((t) => t.name === "gmail.send")).toMatchObject({
      requires_approval: true,
      available_to_you: true,
    });
    expect(tools.some((t) => t.name === "mcp.linear.create_issue")).toBe(true);
    await toolsApi.deletePolicy(rule.id);
    expect((await toolsApi.policies()).some((r) => r.id === rule.id)).toBe(false);

    const policy = await organizationsApi.updatePolicy({
      internal_email_domains: ["agentos.example.com", "example.org"],
    });
    expect(policy.policy_version).toBe(5);
    const member = await organizationsApi.addMember({ email: "new.hire@agentos.example.com", role: "member" });
    expect(member.status).toBe("invited");
    const owner = (await organizationsApi.members()).find((m) => m.role === "owner")!;
    expect((await apiError(organizationsApi.updateMemberRole(owner.id, { role: "viewer" })))?.code).toBe("last_owner");

    const [linear, wiki] = await mcpApi.servers();
    expect((await mcpApi.tools(linear.id)).length).toBe(4);
    expect((await mcpApi.approve(wiki.id)).status).toBe("approved");
    const sync = await mcpApi.sync(wiki.id);
    expect(sync.server.status).toBe("error");
    expect(sync.server.last_error).toMatch(/does not connect to external MCP servers/);

    const usage = await usageApi.summary();
    expect(usage.quotas.task_created).toBe(50000);
    expect(usage.totals.task_created).toBeGreaterThan(0);
    const audit = await auditApi.list({ category: "admin", limit: 5 });
    expect(audit.items[0].action).toBe("mcp.server.approve");
    expect((await billingApi.entitlements()).plan.name).toBe("team");
  });

  it("lab: evaluations run to completion; experiments and ACBE candidates follow the backend's rules", async () => {
    configureDemo({ timeScale: 0.1 }); // runs take ~0.65 s: long enough to observe "runs pending"
    const run = await evaluationsApi.start({
      suite: "core",
      label: "patient_freebusy",
      strategy: { tool_retry: { "calendar.find_free_slots": { max_attempts: 5 } } },
    });
    expect(run.status).toBe("queued");
    const done = await until(async () => {
      const r = await evaluationsApi.get(run.id);
      return r.status === "completed" ? r : null;
    });
    expect(done.metrics).toMatchObject({ task_success_rate: 1, false_completion_rate: 0 });
    expect(done.results).toHaveLength(6);

    const exp = await experimentsApi.create({
      name: "Retry tuning",
      kind: "recovery_strategy",
      variants: [
        { name: "control" },
        { name: "patient", config: { tool_retry: { "calendar.find_free_slots": { max_attempts: 5 } } } },
      ],
    });
    expect(exp.status).toBe("draft");
    expect((await apiError(experimentsApi.decide(exp.id)))?.code).toBe("invalid_experiment_state");
    await experimentsApi.start(exp.id);
    expect((await apiError(experimentsApi.decide(exp.id)))?.code).toBe("experiment_runs_pending");
    const decided = await until(async () => experimentsApi.decide(exp.id).catch(() => null));
    expect(decided).toMatchObject({ status: "evaluated", winner_variant: "patient" });
    expect((await apiError(experimentsApi.rollout(exp.id, { rollout_percentage: 100 })))?.code).toBe("canary_required");
    expect((await experimentsApi.rollout(exp.id, { rollout_percentage: 10 })).status).toBe("canary");

    const passed = (await acbeApi.candidates({ status: "passed" })).items[0];
    expect((await apiError(acbeApi.canary(passed.id, { rollout_percentage: 80 })))?.status).toBe(422);
    expect((await acbeApi.canary(passed.id, { rollout_percentage: 10 })).status).toBe("canary");
    expect((await apiError(acbeApi.promote(passed.id)))?.code).toBe("canary_period_active");
    const canary = (await acbeApi.candidates({ status: "canary" })).items.find((c) => c.id !== passed.id)!;
    expect((await acbeApi.promote(canary.id)).status).toBe("promoted");
    expect((await acbeApi.failures())[0].occurrences).toBeGreaterThanOrEqual(14);
  });
});
