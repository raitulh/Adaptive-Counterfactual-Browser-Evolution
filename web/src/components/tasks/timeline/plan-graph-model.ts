/**
 * Plan graph model (pure). Turns the stored plan (`task.plan`, written by the planner: `steps`,
 * `dependencies`, step `arguments` with `{"$ref": "steps.<id>.output…"}` / `{{steps.<id>.output…}}`
 * references) plus the live step rows into dependency levels:
 *
 *   level 0: steps with no prerequisites (they run in parallel)
 *   level n: steps whose prerequisites all sit in levels < n
 *
 * Dependencies are the union of the declared `dependencies` and the data references in
 * `arguments` — exactly what the execution engine waits for (`_dependency_keys`).
 */
import type { RiskLevel, StepStatus, VerificationStatus } from "@/lib/api";

/** The subset of `StepOut` the graph needs. */
export interface PlanGraphStep {
  id: string;
  step_key: string;
  position: number;
  action: string;
  tool_name: string;
  status: StepStatus;
  verification_status?: VerificationStatus;
  requires_approval?: boolean;
  risk_level?: RiskLevel;
  plan_version?: number;
}

export interface PlanGraphNode {
  key: string;
  stepId: string | null;
  position: number;
  label: string;
  tool: string;
  /** Live status from the backend; null until the step row exists. */
  status: StepStatus | null;
  verification: VerificationStatus | null;
  requiresApproval: boolean;
  riskLevel: RiskLevel | null;
  dependsOn: string[];
  level: number;
}

export interface PlanGraphModel {
  goal: string | null;
  summary: string | null;
  nodes: PlanGraphNode[];
  /** Nodes grouped by dependency level (each inner array can run in parallel). */
  levels: PlanGraphNode[][];
  edges: Array<{ from: string; to: string }>;
  /** Any level runs more than one step at once. */
  parallel: boolean;
  /** The plan answers directly without actions. */
  directResponse: boolean;
  /** Dependencies came from the stored plan (false = inferred from step order). */
  dependenciesKnown: boolean;
}

const REF_PATTERN = /^steps\.([a-z][a-z0-9_]{0,40})\.output(?:\.[A-Za-z0-9_.-]+)?$/;
const TEMPLATE_PATTERN = /\{\{\s*steps\.([a-z][a-z0-9_]{0,40})\.output(?:\.[A-Za-z0-9_.-]+)?\s*\}\}/g;
const MAX_DEPTH = 12;

/** Step ids referenced anywhere inside an argument structure (mirrors backend `collect_refs`). */
export function extractStepRefs(value: unknown, depth = 0, found: Set<string> = new Set()): Set<string> {
  if (depth > MAX_DEPTH || value === null || value === undefined) return found;
  if (typeof value === "string") {
    for (const m of value.matchAll(TEMPLATE_PATTERN)) found.add(m[1]);
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) extractStepRefs(item, depth + 1, found);
    return found;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === "$ref" && typeof obj.$ref === "string") {
      const m = REF_PATTERN.exec(obj.$ref.trim());
      if (m) found.add(m[1]);
      return found;
    }
    for (const item of Object.values(obj)) extractStepRefs(item, depth + 1, found);
  }
  return found;
}

interface PlanStepJson {
  step_id?: unknown;
  action?: unknown;
  tool?: unknown;
  arguments?: unknown;
  dependencies?: unknown;
  requires_approval?: unknown;
  risk_level?: unknown;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

const RISKS = new Set(["low", "medium", "high", "critical"]);

export function buildPlanGraph(input: {
  plan: Record<string, unknown> | null | undefined;
  steps: readonly PlanGraphStep[];
  /** Only steps of this plan version are shown (older versions were superseded). */
  planVersion?: number;
}): PlanGraphModel {
  const plan = asRecord(input.plan);
  const current = input.steps
    .filter(
      (s) => input.planVersion === undefined || s.plan_version === undefined || s.plan_version === input.planVersion,
    )
    .slice()
    .sort((a, b) => a.position - b.position);
  const rowByKey = new Map(current.map((s) => [s.step_key, s]));

  const planSteps: PlanStepJson[] = Array.isArray(plan?.steps) ? (plan!.steps as PlanStepJson[]) : [];
  const declared = asRecord(plan?.dependencies) ?? {};
  const dependenciesKnown = planSteps.length > 0 || Object.keys(declared).length > 0;

  // Node order: the plan's order (the planner's topological order), then any rows it lacks.
  const order: string[] = [];
  const seen = new Set<string>();
  for (const ps of planSteps) {
    if (typeof ps.step_id === "string" && !seen.has(ps.step_id)) {
      order.push(ps.step_id);
      seen.add(ps.step_id);
    }
  }
  for (const row of current) {
    if (!seen.has(row.step_key)) {
      order.push(row.step_key);
      seen.add(row.step_key);
    }
  }
  const planByKey = new Map(
    planSteps.filter((p) => typeof p.step_id === "string").map((p) => [p.step_id as string, p]),
  );

  const deps = new Map<string, string[]>();
  order.forEach((key, index) => {
    const set = new Set<string>();
    const dec = declared[key];
    if (Array.isArray(dec)) for (const d of dec) if (typeof d === "string") set.add(d);
    const ps = planByKey.get(key);
    if (Array.isArray(ps?.dependencies)) for (const d of ps.dependencies) if (typeof d === "string") set.add(d);
    if (ps?.arguments !== undefined) extractStepRefs(ps.arguments, 0, set);
    if (!dependenciesKnown && index > 0) set.add(order[index - 1]); // no plan stored: show the recorded order
    set.delete(key);
    deps.set(
      key,
      [...set].filter((d) => seen.has(d)),
    );
  });

  // Longest-path layering, cycle-safe.
  const level = new Map<string, number>();
  const visiting = new Set<string>();
  const levelOf = (key: string): number => {
    const known = level.get(key);
    if (known !== undefined) return known;
    if (visiting.has(key)) return 0;
    visiting.add(key);
    const ds = deps.get(key) ?? [];
    const lv = ds.length ? Math.max(...ds.map(levelOf)) + 1 : 0;
    visiting.delete(key);
    level.set(key, lv);
    return lv;
  };

  const nodes: PlanGraphNode[] = order.map((key, index) => {
    const row = rowByKey.get(key);
    const ps = planByKey.get(key);
    const risk =
      row?.risk_level ??
      (typeof ps?.risk_level === "string" && RISKS.has(ps.risk_level) ? (ps.risk_level as RiskLevel) : null);
    return {
      key,
      stepId: row?.id ?? null,
      position: row?.position ?? index,
      label: row?.action ?? (typeof ps?.action === "string" ? ps.action : key),
      tool: row?.tool_name ?? (typeof ps?.tool === "string" ? ps.tool : ""),
      status: row?.status ?? null,
      verification: row?.verification_status ?? null,
      requiresApproval: row?.requires_approval ?? ps?.requires_approval === true,
      riskLevel: risk,
      dependsOn: deps.get(key) ?? [],
      level: levelOf(key),
    };
  });

  const maxLevel = nodes.reduce((m, n) => Math.max(m, n.level), -1);
  const levels: PlanGraphNode[][] = Array.from({ length: maxLevel + 1 }, () => []);
  for (const n of nodes) levels[n.level].push(n);
  for (const l of levels) l.sort((a, b) => a.position - b.position);

  return {
    goal: typeof plan?.goal === "string" ? plan.goal : null,
    summary: typeof plan?.summary === "string" && plan.summary ? plan.summary : null,
    nodes,
    levels,
    edges: nodes.flatMap((n) => n.dependsOn.map((from) => ({ from, to: n.key }))),
    parallel: levels.some((l) => l.length > 1),
    directResponse: nodes.length === 0 && typeof plan?.direct_response === "string" && plan.direct_response.length > 0,
    dependenciesKnown,
  };
}
