/**
 * Self-improvement lab: evaluation runs (queued → running → completed over a few seconds),
 * experiments (draft → running → evaluated → canary → promoted / rolled back) and ACBE strategy
 * candidates, with the backend's state rules and error codes.
 */
import type { AcbeExperimentOut, EvaluationRunOut } from "@/lib/api";
import { evaluationRun, SUITES } from "../../fixtures/lab";
import { Body, conflict, type Ctx, DemoHttpError, json, notFound, paginate, queryEnum, unprocessable } from "../http";
import type { Router, Srv } from "../router";
import type { CandidateRec, DemoStore, EvaluationRunRec, ExperimentRec } from "../store";
import { clone, DAY, iso, uuid } from "../util";
import { idempotent, requirePermission } from "./common";

const runOut = (r: EvaluationRunRec): EvaluationRunOut => {
  const { results: _r, ...out } = r;
  void _r;
  return clone(out);
};

/** A strategy "fixes" the flaky-provider cases when it retries free/busy more patiently. */
function failingCases(strategy: Record<string, unknown>): string[] {
  const retry = (strategy.tool_retry as Record<string, { max_attempts?: number }> | undefined)?.[
    "calendar.find_free_slots"
  ];
  return retry && (retry.max_attempts ?? 0) > 3 ? [] : ["core.flaky_calendar", "acbe.freebusy_retry"];
}

/** Queue a run and simulate its lifecycle on the scheduler. */
function startRun(
  store: DemoStore,
  suite: string,
  label: string,
  strategy: Record<string, unknown>,
  opts: { experimentId?: string; variant?: string; onDone?: () => void } = {},
): EvaluationRunRec {
  const now = store.nowIso();
  const run: EvaluationRunRec = {
    id: uuid(),
    suite,
    strategy_label: label,
    strategy_config: clone(strategy),
    model: "scripted",
    status: "queued",
    repetitions: 1,
    case_ids: null,
    metrics: {},
    error: null,
    experiment_id: opts.experimentId ?? null,
    variant: opts.variant ?? null,
    tenant_id: store.org.id,
    created_by: store.me.id,
    created_at: now,
    started_at: null,
    completed_at: null,
    results: [],
  };
  store.evaluationRuns.push(run);
  store.sched.after(1200, () => {
    run.status = "running";
    run.started_at = store.nowIso();
  });
  store.sched.after(6500, () => {
    const done = evaluationRun(store, run.id, suite, label, store.now(), {
      failing: failingCases(strategy),
      experimentId: run.experiment_id,
      variant: run.variant,
      strategy,
    });
    Object.assign(run, {
      status: "completed",
      completed_at: done.completed_at,
      metrics: done.metrics,
      results: (done.results ?? []).map((x) => ({ ...x, id: uuid() })),
    });
    opts.onDone?.();
  });
  return run;
}

async function startEvaluation(ctx: Ctx, srv: Srv) {
  const { store } = srv;
  requirePermission(store, "experiments:manage");
  const raw = await ctx.json();
  const b = new Body(raw, { optional: true }).forbidExtra([
    "suite",
    "label",
    "repetitions",
    "model_mode",
    "platform",
    "case_ids",
    "strategy",
  ]);
  const suite = b.optStr("suite", { max: 40 }) ?? "core";
  const label = b.optStr("label", { min: 1, max: 80 }) ?? "baseline";
  b.optNum("repetitions", { int: true, min: 1, max: 5 });
  b.optEnum("model_mode", ["scripted", "configured"] as const);
  const platform = b.optBool("platform");
  const strategy = b.optObj("strategy") ?? {};
  b.done();
  if (platform) throw new DemoHttpError(403, "forbidden", "Platform-level runs require a platform administrator.");
  if (!SUITES.some((s) => s.name === suite)) throw unprocessable(`Unknown evaluation suite '${suite}'`);
  return idempotent(ctx, srv, raw, () => {
    const run = startRun(store, suite, label, strategy);
    store.audit(
      {
        category: "experiment",
        action: "evaluation.start",
        resource_type: "evaluation_run",
        resource_id: run.id,
        metadata: { suite },
      },
      ctx.requestId,
    );
    return { status: 202, body: runOut(run) };
  });
}

// ---------------------------------------------------------------------------- experiments
function findExperiment(ctx: Ctx, store: DemoStore): ExperimentRec {
  const e = store.experiments.find((x) => x.id === ctx.params.experiment_id);
  if (!e) throw notFound("Experiment not found");
  return e;
}

async function createExperiment(ctx: Ctx, srv: Srv) {
  const { store } = srv;
  requirePermission(store, "experiments:manage");
  const raw = await ctx.json();
  const b = new Body(raw).forbidExtra([
    "name",
    "kind",
    "hypothesis",
    "evaluation_set",
    "repetitions",
    "variants",
    "platform",
  ]);
  const name = b.str("name", { min: 1, max: 200 });
  const kind = b.enumOf("kind", [
    "agent_version",
    "planner_strategy",
    "memory_retrieval",
    "verification_strategy",
    "recovery_strategy",
    "acbe_strategy",
  ] as const);
  const hypothesis = b.optStr("hypothesis", { max: 2000 }) ?? "";
  const set = b.optStr("evaluation_set", { max: 40 }) ?? "core";
  const repetitions = b.optNum("repetitions", { int: true, min: 1, max: 5 }) ?? 1;
  const variants = b.data.variants;
  if (!Array.isArray(variants) || variants.length < 2)
    b.fail("variants", "List should have at least 2 items after validation", "too_short");
  else {
    variants.forEach((v, i) => {
      if (!v || typeof v !== "object" || typeof (v as { name?: unknown }).name !== "string")
        b.fail(`variants.${i}.name`, "Field required", "missing");
    });
    const names = variants.map((v) => (v as { name?: string }).name);
    if (new Set(names).size !== names.length) b.fail("variants", "Value error, variant names must be unique");
  }
  if (b.optBool("platform"))
    throw new DemoHttpError(403, "forbidden", "Platform-level experiments require a platform administrator.");
  b.done();
  return idempotent(ctx, srv, raw, () => {
    const now = store.nowIso();
    const e: ExperimentRec = {
      id: uuid(),
      name,
      kind,
      hypothesis,
      evaluation_set: set,
      repetitions,
      status: "draft",
      variants: (variants as Record<string, unknown>[]).map((v) => ({ config: {}, weight: 1, ...v })),
      metrics: {},
      safety_checks: {},
      winner_variant: null,
      winner_reason: null,
      rollout_percentage: 0,
      rollback_reason: null,
      rolled_back_at: null,
      strategy_candidate_id: null,
      approved_at: null,
      approved_by: null,
      decided_at: null,
      created_by: store.me.id,
      tenant_id: store.org.id,
      created_at: now,
      updated_at: now,
    };
    store.experiments.push(e);
    store.audit(
      { category: "experiment", action: "experiment.create", resource_type: "experiment", resource_id: e.id },
      ctx.requestId,
    );
    return { status: 201, body: clone(e) };
  });
}

function experimentRuns(store: DemoStore, e: ExperimentRec) {
  return store.evaluationRuns.filter((r) => r.experiment_id === e.id);
}

function decide(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "experiments:manage");
  const e = findExperiment(ctx, store);
  if (!["running", "evaluated", "rejected"].includes(e.status))
    throw conflict(`A ${e.status} experiment cannot be decided`, "invalid_experiment_state");
  const names = e.variants.map((v) => String(v.name));
  const latest = new Map<string, EvaluationRunRec>();
  for (const r of experimentRuns(store, e)) if (r.variant) latest.set(r.variant, r);
  const unfinished = names.filter((n) => latest.get(n)?.status !== "completed");
  if (unfinished.length)
    throw conflict("Evaluation runs have not finished for every variant", "experiment_runs_pending", {
      variants: unfinished,
    });
  const rate = (n: string) => Number((latest.get(n)!.metrics as { task_success_rate?: number }).task_success_rate ?? 0);
  const [control, ...challengers] = names;
  const best = challengers.sort((x, y) => rate(y) - rate(x))[0];
  const winner = best && rate(best) > rate(control) ? best : null;
  e.metrics = Object.fromEntries(names.map((n) => [n, latest.get(n)!.metrics]));
  e.safety_checks = { false_completion_rate: "passed", unauthorized_action_rate: "passed" };
  e.winner_variant = winner;
  e.winner_reason = winner
    ? `Higher task success (${rate(winner)} vs ${rate(control)}) with no safety regressions.`
    : "No challenger beat the control.";
  e.status = winner ? "evaluated" : "rejected";
  e.decided_at = e.updated_at = store.nowIso();
  store.audit(
    {
      category: "experiment",
      action: "experiment.decide",
      resource_type: "experiment",
      resource_id: e.id,
      metadata: { winner, status: e.status },
    },
    ctx.requestId,
  );
  return json(ctx, 200, clone(e));
}

async function rollout(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "experiments:manage");
  const b = new Body(await ctx.json());
  const pct = b.num("rollout_percentage", { int: true, min: 1, max: 100 });
  b.done();
  const e = findExperiment(ctx, store);
  if (!["evaluated", "canary"].includes(e.status) || !e.winner_variant) {
    throw conflict(
      "Only an evaluated experiment with a winning challenger can be rolled out",
      "invalid_experiment_state",
    );
  }
  if (pct >= 100 && e.status !== "canary")
    throw conflict("Roll out as a canary first; promotion follows the canary period", "canary_required");
  e.rollout_percentage = pct;
  e.status = pct >= 100 ? "promoted" : "canary";
  e.approved_at ??= store.nowIso();
  e.approved_by ??= store.me.id;
  e.updated_at = store.nowIso();
  store.audit(
    {
      category: "experiment",
      action: "experiment.rollout",
      resource_type: "experiment",
      resource_id: e.id,
      metadata: { rollout_percentage: pct },
    },
    ctx.requestId,
  );
  return json(ctx, 200, clone(e));
}

async function rollbackExperiment(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "experiments:manage");
  const b = new Body(await ctx.json());
  const reason = b.str("reason", { min: 1, max: 1000 });
  b.done();
  const e = findExperiment(ctx, store);
  if (!["evaluated", "canary", "promoted"].includes(e.status))
    throw conflict(`A ${e.status} experiment cannot be rolled back`, "invalid_experiment_state");
  Object.assign(e, {
    status: "rolled_back",
    rollout_percentage: 0,
    rollback_reason: reason,
    rolled_back_at: store.nowIso(),
    updated_at: store.nowIso(),
  });
  store.audit(
    {
      category: "experiment",
      action: "experiment.rollback",
      resource_type: "experiment",
      resource_id: e.id,
      metadata: { reason },
    },
    ctx.requestId,
  );
  return json(ctx, 200, clone(e));
}

// ---------------------------------------------------------------------------- ACBE
function findCandidate(ctx: Ctx, store: DemoStore): CandidateRec {
  const c = store.candidates.find((x) => x.id === ctx.params.candidate_id);
  if (!c) throw notFound("Strategy candidate not found");
  return c;
}

const candidateOut = ({ experiments: _e, ...c }: CandidateRec) => {
  void _e;
  return clone(c);
};

function evaluateCandidate(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "experiments:manage");
  const c = findCandidate(ctx, store);
  if (c.status !== "draft" && c.status !== "evaluating")
    throw conflict(`A ${c.status} candidate cannot be re-evaluated`, "invalid_candidate_state");
  c.status = "evaluating";
  c.updated_at = store.nowIso();
  const started = store.now();
  const experiment: AcbeExperimentOut = {
    id: uuid(),
    evaluation_suite: "acbe",
    experiment_version: c.experiments.length + 1,
    status: "running",
    started_at: iso(started),
    completed_at: null,
    baseline_metrics: {},
    candidate_metrics: {},
    regression_metrics: {},
    safety_checks: {},
    confidence: null,
    decision: null,
    decision_reason: null,
  };
  c.experiments.push(experiment);
  store.sched.after(7000, () => {
    const passes = failingCases(c.candidate_config).length === 0 || Boolean(c.candidate_config.verification_readback);
    Object.assign(experiment, {
      status: "completed",
      completed_at: store.nowIso(),
      baseline_metrics: { task_success_rate: 0.667, recovery_success_rate: 0.5 },
      candidate_metrics: passes
        ? { task_success_rate: 1, recovery_success_rate: 1 }
        : { task_success_rate: 0.667, recovery_success_rate: 0.5 },
      regression_metrics: { false_completion_rate: 0, unauthorized_action_rate: 0 },
      safety_checks: { destructive_retries: "none", false_completion: "passed" },
      confidence: passes ? 0.91 : 0.64,
      decision: passes ? "passed" : "rejected",
      decision_reason: passes ? "Candidate improves recovery without regressions." : "No improvement over baseline.",
    });
    c.status = passes ? "passed" : "rejected";
    c.updated_at = store.nowIso();
  });
  store.audit(
    {
      category: "experiment",
      action: "acbe.candidate.evaluate",
      resource_type: "strategy_candidate",
      resource_id: c.id,
    },
    ctx.requestId,
  );
  return json(ctx, 202, candidateOut(c));
}

async function canary(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "experiments:manage");
  const b = new Body(await ctx.json());
  const pct = b.num("rollout_percentage", { int: true });
  b.done();
  const c = findCandidate(ctx, store);
  if (c.status !== "passed" && c.status !== "canary") {
    throw conflict("Only a candidate that passed evaluation can enter a canary", "invalid_candidate_state", {
      status: c.status,
    });
  }
  if (pct < 1 || pct > 50)
    throw unprocessable("Canary rollout must be between 1 and 50%", "validation_failed", { max_canary_percentage: 50 });
  if (c.status !== "canary") c.approved_at = store.nowIso();
  c.approved_by = store.me.id;
  c.status = "canary";
  c.rollout_percentage = pct;
  c.updated_at = store.nowIso();
  store.audit(
    {
      category: "experiment",
      action: "acbe.canary.approve",
      resource_type: "strategy_candidate",
      resource_id: c.id,
      metadata: { rollout_percentage: pct },
    },
    ctx.requestId,
  );
  return json(ctx, 200, candidateOut(c));
}

function promote(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "experiments:manage");
  const c = findCandidate(ctx, store);
  if (c.status !== "canary" || !c.approved_at)
    throw conflict("Only a canary can be promoted", "invalid_candidate_state", { status: c.status });
  const elapsed = store.now() - Date.parse(c.approved_at);
  if (elapsed < DAY) {
    throw conflict("The canary period has not finished yet", "canary_period_active", {
      ends_at: iso(Date.parse(c.approved_at) + DAY),
    });
  }
  Object.assign(c, {
    status: "promoted",
    rollout_percentage: 100,
    promoted_at: store.nowIso(),
    updated_at: store.nowIso(),
  });
  store.audit(
    { category: "experiment", action: "acbe.promote", resource_type: "strategy_candidate", resource_id: c.id },
    ctx.requestId,
  );
  return json(ctx, 200, candidateOut(c));
}

async function rollbackCandidate(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "experiments:manage");
  const b = new Body(await ctx.json());
  const reason = b.str("reason", { min: 1, max: 1000 });
  b.done();
  const c = findCandidate(ctx, store);
  if (!["canary", "promoted", "passed"].includes(c.status))
    throw conflict(`A ${c.status} candidate cannot be rolled back`, "invalid_candidate_state");
  Object.assign(c, {
    status: "rolled_back",
    rollout_percentage: 0,
    rollback_reason: reason,
    rolled_back_at: store.nowIso(),
    updated_at: store.nowIso(),
  });
  store.audit(
    {
      category: "experiment",
      action: "acbe.rollback",
      resource_type: "strategy_candidate",
      resource_id: c.id,
      metadata: { reason },
    },
    ctx.requestId,
  );
  return json(ctx, 200, candidateOut(c));
}

export function labRoutes(r: Router): void {
  r.add("GET", "/evaluations", (ctx, { store }) => json(ctx, 200, paginate(ctx, store.evaluationRuns, runOut)))
    .add("GET", "/evaluations/suites", (ctx) => json(ctx, 200, clone(SUITES)))
    .add("GET", "/evaluations/{run_id}", (ctx, { store }) => {
      const run = store.evaluationRuns.find((x) => x.id === ctx.params.run_id);
      if (!run) throw notFound("Evaluation run not found");
      return json(ctx, 200, clone(run));
    })
    .add("POST", "/evaluations", startEvaluation)
    .add("GET", "/experiments", (ctx, { store }) => json(ctx, 200, paginate(ctx, store.experiments, clone)))
    .add("POST", "/experiments", createExperiment)
    .add("GET", "/experiments/{experiment_id}", (ctx, { store }) => {
      const e = findExperiment(ctx, store);
      return json(ctx, 200, { ...clone(e), runs: experimentRuns(store, e).map(runOut) });
    })
    .add("POST", "/experiments/{experiment_id}/start", (ctx, { store }) => {
      requirePermission(store, "experiments:manage");
      const e = findExperiment(ctx, store);
      if (e.status !== "draft")
        throw conflict(`A ${e.status} experiment cannot be started`, "invalid_experiment_state");
      for (const v of e.variants) {
        startRun(store, e.evaluation_set, String(v.name), (v.config as Record<string, unknown>) ?? {}, {
          experimentId: e.id,
          variant: String(v.name),
        });
      }
      e.status = "running";
      e.updated_at = store.nowIso();
      store.audit(
        { category: "experiment", action: "experiment.start", resource_type: "experiment", resource_id: e.id },
        ctx.requestId,
      );
      return json(ctx, 202, clone(e));
    })
    .add("POST", "/experiments/{experiment_id}/decide", decide)
    .add("POST", "/experiments/{experiment_id}/rollout", rollout)
    .add("POST", "/experiments/{experiment_id}/rollback", rollbackExperiment)
    .add("GET", "/acbe/failures", (ctx, { store }) => {
      requirePermission(store, "experiments:manage");
      return json(ctx, 200, clone([...store.failurePatterns].sort((a, b) => b.occurrences - a.occurrences)));
    })
    .add("GET", "/acbe/candidates", (ctx, { store }) => {
      requirePermission(store, "experiments:manage");
      const status = queryEnum(ctx, "status", [
        "draft",
        "evaluating",
        "passed",
        "rejected",
        "canary",
        "promoted",
        "rolled_back",
        "retired",
      ] as const);
      return json(
        ctx,
        200,
        paginate(
          ctx,
          store.candidates.filter((c) => !status || c.status === status),
          candidateOut,
        ),
      );
    })
    .add("GET", "/acbe/candidates/{candidate_id}", (ctx, { store }) => {
      requirePermission(store, "experiments:manage");
      const c = findCandidate(ctx, store);
      return json(ctx, 200, { ...candidateOut(c), experiments: clone(c.experiments) });
    })
    .add("POST", "/acbe/candidates/{candidate_id}/evaluate", evaluateCandidate)
    .add("POST", "/acbe/candidates/{candidate_id}/canary", canary)
    .add("POST", "/acbe/candidates/{candidate_id}/promote", promote)
    .add("POST", "/acbe/candidates/{candidate_id}/rollback", rollbackCandidate);
}
