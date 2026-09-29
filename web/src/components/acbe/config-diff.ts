/**
 * Strategy config diff (pure, unit-tested). ACBE candidates store a *patch*; what tasks would run is
 * the current strategy merged with it — mirroring backend `StrategyConfig.merged`
 * (app/acbe/runtime.py): planner hints are appended (deduped, max 10), tool_retry and
 * verification_readback are merged per tool, locator order and memory weights are replaced when set.
 */
export type StrategyLike = Record<string, unknown>;

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function mergeStrategy(base: StrategyLike, patch: StrategyLike): StrategyLike {
  const hints = [...new Set([...arr(base.planner_hints), ...arr(patch.planner_hints)].map(String))].slice(0, 10);
  const locator = arr(patch.browser_locator_order).length
    ? arr(patch.browser_locator_order)
    : arr(base.browser_locator_order);
  return {
    planner_hints: hints,
    tool_retry: {
      ...(isObj(base.tool_retry) ? base.tool_retry : {}),
      ...(isObj(patch.tool_retry) ? patch.tool_retry : {}),
    },
    verification_readback: {
      ...(isObj(base.verification_readback) ? base.verification_readback : {}),
      ...(isObj(patch.verification_readback) ? patch.verification_readback : {}),
    },
    browser_locator_order: locator,
    memory_weights:
      (isObj(patch.memory_weights) ? patch.memory_weights : null) ??
      (isObj(base.memory_weights) ? base.memory_weights : null),
  };
}

export interface DiffRow {
  /** Dotted path, e.g. "verification_readback.calendar.create_event.attempts". Tool names keep their dots. */
  path: string[];
  kind: "added" | "removed" | "changed";
  before: unknown;
  after: unknown;
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isEmpty(v: unknown): boolean {
  return (
    v === null || v === undefined || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0)
  );
}

/**
 * Leaf-level differences between two configs. Arrays are compared as whole values (order matters for
 * locator order); objects are walked. Empty containers count as absent.
 */
export function diffStrategy(before: StrategyLike, after: StrategyLike, prefix: string[] = []): DiffRow[] {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();
  const rows: DiffRow[] = [];
  for (const key of keys) {
    const a = before?.[key];
    const b = after?.[key];
    const path = [...prefix, key];
    if (equal(a, b) || (isEmpty(a) && isEmpty(b))) continue;
    if (isObj(a) && isObj(b)) {
      rows.push(...diffStrategy(a, b, path));
    } else if (isEmpty(a)) {
      rows.push({ path, kind: "added", before: null, after: b });
    } else if (isEmpty(b)) {
      rows.push({ path, kind: "removed", before: a, after: null });
    } else {
      rows.push({ path, kind: "changed", before: a, after: b });
    }
  }
  return rows;
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
