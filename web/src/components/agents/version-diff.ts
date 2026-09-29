/**
 * Agent version comparison: a line-based diff for instructions and structured, field-level diffs for
 * the policies and limits. Pure functions — no React — so the logic is unit-tested.
 */
import { usd } from "@/lib/format";
import type {
  AgentVersionIn,
  ExecutionLimits,
  MemoryPolicy,
  ModelPolicy,
  ToolPolicy,
  VerificationPolicy,
} from "@/lib/api";

// ---------------------------------------------------------------------------------- line diff

export type LineOpType = "equal" | "add" | "remove";

export interface LineOp {
  type: LineOpType;
  text: string;
  /** 1-based line number in the old text (equal/remove). */
  oldNo?: number;
  /** 1-based line number in the new text (equal/add). */
  newNo?: number;
}

export function splitLines(text: string | null | undefined): string[] {
  if (!text) return [];
  return text.replace(/\r\n?/g, "\n").split("\n");
}

/** Above this many cells the LCS table is skipped and the changed middle is shown as replace. */
const MAX_LCS_CELLS = 4_000_000;

/**
 * Line diff (longest common subsequence). Common prefix/suffix are trimmed first, so typical edits
 * to long instructions stay cheap. Deletions are listed before insertions inside a change block.
 */
export function diffLines(before: string | null | undefined, after: string | null | undefined): LineOp[] {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ops: LineOp[] = [];
  for (let i = 0; i < start; i++) ops.push({ type: "equal", text: a[i], oldNo: i + 1, newNo: i + 1 });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;

  if (n > 0 || m > 0) {
    if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_LCS_CELLS) {
      midA.forEach((text, i) => ops.push({ type: "remove", text, oldNo: start + i + 1 }));
      midB.forEach((text, j) => ops.push({ type: "add", text, newNo: start + j + 1 }));
    } else {
      // lcs[i][j] = LCS length of midA[i:] and midB[j:]
      const w = m + 1;
      const lcs = new Int32Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
          lcs[i * w + j] = midA[i] === midB[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
        }
      }
      let i = 0;
      let j = 0;
      const removes: LineOp[] = [];
      const adds: LineOp[] = [];
      const flush = () => {
        ops.push(...removes, ...adds);
        removes.length = 0;
        adds.length = 0;
      };
      while (i < n || j < m) {
        if (i < n && j < m && midA[i] === midB[j]) {
          flush();
          ops.push({ type: "equal", text: midA[i], oldNo: start + i + 1, newNo: start + j + 1 });
          i++;
          j++;
        } else if (j < m && (i >= n || lcs[i * w + j + 1] >= lcs[(i + 1) * w + j])) {
          adds.push({ type: "add", text: midB[j], newNo: start + j + 1 });
          j++;
        } else {
          removes.push({ type: "remove", text: midA[i], oldNo: start + i + 1 });
          i++;
        }
      }
      flush();
    }
  }

  for (let k = 0; k < a.length - endA; k++) {
    ops.push({ type: "equal", text: a[endA + k], oldNo: endA + k + 1, newNo: endB + k + 1 });
  }
  return ops;
}

export function lineStats(ops: LineOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === "add") added++;
    else if (op.type === "remove") removed++;
  }
  return { added, removed };
}

export type DiffBlock = { kind: "lines"; ops: LineOp[] } | { kind: "collapsed"; ops: LineOp[] };

/**
 * Groups a diff for display: changed lines with `context` unchanged lines around them; longer
 * unchanged runs become collapsible blocks.
 */
export function toDisplayBlocks(ops: LineOp[], context = 3): DiffBlock[] {
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op.type === "equal") return;
    for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) keep[k] = true;
  });
  const blocks: DiffBlock[] = [];
  let run: LineOp[] = [];
  let runKept: boolean | null = null;
  const push = () => {
    if (run.length === 0) return;
    // A tiny hidden run is not worth a toggle.
    if (runKept === false && run.length <= 2) blocks.push({ kind: "lines", ops: run });
    else blocks.push({ kind: runKept ? "lines" : "collapsed", ops: run });
    run = [];
  };
  ops.forEach((op, idx) => {
    if (runKept !== null && keep[idx] !== runKept) push();
    runKept = keep[idx];
    run.push(op);
  });
  push();
  // Merge adjacent "lines" blocks produced by tiny hidden runs.
  return blocks.reduce<DiffBlock[]>((acc, block) => {
    const last = acc[acc.length - 1];
    if (last && last.kind === "lines" && block.kind === "lines") last.ops.push(...block.ops);
    else acc.push({ kind: block.kind, ops: [...block.ops] });
    return acc;
  }, []);
}

// ---------------------------------------------------------------------------- structured diff

/** Defaults exactly as the backend models declare them (app/agents/schemas.py). */
export const POLICY_DEFAULTS = {
  model_policy: { default: null, fast: null, reasoning: null, fallbacks: [], planning_tier: "default" },
  tool_policy: { allowed: ["*"], denied: [] },
  memory_policy: { enabled: true, max_items: 8, extract_after_task: true },
  execution_limits: {
    max_steps: null,
    max_tool_calls: null,
    max_model_calls: null,
    max_duration_seconds: null,
    max_cost_usd: null,
    max_browser_actions: null,
  },
  verification_policy: { readback_attempts: 3, readback_delay_ms: 500 },
} as const;

export interface NormalizedConfig {
  instructions: string;
  model_policy: Required<{ [K in keyof ModelPolicy]-?: ModelPolicy[K] }>;
  tool_policy: Required<ToolPolicy>;
  memory_policy: Required<MemoryPolicy>;
  execution_limits: Required<{ [K in keyof ExecutionLimits]-?: ExecutionLimits[K] | null }>;
  verification_policy: Required<VerificationPolicy>;
}

export function normalizeConfig(v: Partial<AgentVersionIn> | null | undefined): NormalizedConfig {
  const d = POLICY_DEFAULTS;
  return {
    instructions: v?.instructions ?? "",
    model_policy: {
      default: v?.model_policy?.default ?? null,
      fast: v?.model_policy?.fast ?? null,
      reasoning: v?.model_policy?.reasoning ?? null,
      fallbacks: [...(v?.model_policy?.fallbacks ?? [])],
      planning_tier: v?.model_policy?.planning_tier ?? d.model_policy.planning_tier,
    },
    tool_policy: {
      allowed: [...(v?.tool_policy?.allowed ?? d.tool_policy.allowed)],
      denied: [...(v?.tool_policy?.denied ?? [])],
    },
    memory_policy: {
      enabled: v?.memory_policy?.enabled ?? d.memory_policy.enabled,
      max_items: v?.memory_policy?.max_items ?? d.memory_policy.max_items,
      extract_after_task: v?.memory_policy?.extract_after_task ?? d.memory_policy.extract_after_task,
    },
    execution_limits: {
      max_steps: v?.execution_limits?.max_steps ?? null,
      max_tool_calls: v?.execution_limits?.max_tool_calls ?? null,
      max_model_calls: v?.execution_limits?.max_model_calls ?? null,
      max_duration_seconds: v?.execution_limits?.max_duration_seconds ?? null,
      max_cost_usd: v?.execution_limits?.max_cost_usd ?? null,
      max_browser_actions: v?.execution_limits?.max_browser_actions ?? null,
    },
    verification_policy: {
      readback_attempts: v?.verification_policy?.readback_attempts ?? d.verification_policy.readback_attempts,
      readback_delay_ms: v?.verification_policy?.readback_delay_ms ?? d.verification_policy.readback_delay_ms,
    },
  };
}

export type SectionKey = "model_policy" | "tool_policy" | "memory_policy" | "execution_limits" | "verification_policy";

export const SECTION_LABELS: Record<SectionKey, string> = {
  model_policy: "Model policy",
  tool_policy: "Tool policy",
  memory_policy: "Memory policy",
  execution_limits: "Execution limits",
  verification_policy: "Verification policy",
};

export const FIELD_LABELS: Record<SectionKey, Record<string, string>> = {
  model_policy: {
    planning_tier: "Planning tier",
    default: "Default model",
    fast: "Fast model",
    reasoning: "Reasoning model",
    fallbacks: "Fallback models",
  },
  tool_policy: { allowed: "Allowed tools", denied: "Denied tools" },
  memory_policy: { enabled: "Memory enabled", max_items: "Memories per task", extract_after_task: "Extract after task" },
  execution_limits: {
    max_steps: "Max steps",
    max_tool_calls: "Max tool calls",
    max_model_calls: "Max model calls",
    max_duration_seconds: "Max duration",
    max_cost_usd: "Max cost",
    max_browser_actions: "Max browser actions",
  },
  verification_policy: { readback_attempts: "Read-back attempts", readback_delay_ms: "Read-back delay" },
};

/** Lists whose order is meaningful (fallback models are tried in order). */
const ORDERED_LISTS = new Set(["model_policy.fallbacks"]);

export type Scalar = string | number | boolean | null;

export type FieldDiff =
  | { kind: "scalar"; section: SectionKey; field: string; label: string; before: Scalar; after: Scalar }
  | {
      kind: "list";
      section: SectionKey;
      field: string;
      label: string;
      before: string[];
      after: string[];
      added: string[];
      removed: string[];
      /** Same items, different order (only meaningful for ordered lists). */
      reordered: boolean;
    };

export interface SectionDiff {
  section: SectionKey;
  label: string;
  changes: FieldDiff[];
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function diffSection(section: SectionKey, before: Record<string, unknown>, after: Record<string, unknown>): SectionDiff {
  const labels = FIELD_LABELS[section];
  const fields = [...new Set([...Object.keys(labels), ...Object.keys(before), ...Object.keys(after)])];
  const changes: FieldDiff[] = [];
  for (const field of fields) {
    const b = before[field];
    const a = after[field];
    const label = labels[field] ?? field;
    if (Array.isArray(b) || Array.isArray(a)) {
      const bl = (Array.isArray(b) ? b : []).map(String);
      const al = (Array.isArray(a) ? a : []).map(String);
      if (sameList(bl, al)) continue;
      const added = al.filter((x) => !bl.includes(x));
      const removed = bl.filter((x) => !al.includes(x));
      const ordered = ORDERED_LISTS.has(`${section}.${field}`);
      if (!ordered && added.length === 0 && removed.length === 0) continue; // order-insensitive list
      changes.push({
        kind: "list",
        section,
        field,
        label,
        before: bl,
        after: al,
        added,
        removed,
        reordered: added.length === 0 && removed.length === 0,
      });
    } else if ((b ?? null) !== (a ?? null)) {
      changes.push({ kind: "scalar", section, field, label, before: (b ?? null) as Scalar, after: (a ?? null) as Scalar });
    }
  }
  return { section, label: SECTION_LABELS[section], changes };
}

export interface VersionDiff {
  instructions: LineOp[];
  instructionStats: { added: number; removed: number };
  instructionsChanged: boolean;
  sections: SectionDiff[];
  /** Sections with at least one change. */
  changedSections: SectionDiff[];
  /** Total number of changed fields (instructions count as one). */
  changeCount: number;
  identical: boolean;
}

export function diffConfigs(before: Partial<AgentVersionIn> | null | undefined, after: Partial<AgentVersionIn> | null | undefined): VersionDiff {
  const b = normalizeConfig(before);
  const a = normalizeConfig(after);
  const instructions = diffLines(b.instructions, a.instructions);
  const instructionStats = lineStats(instructions);
  const instructionsChanged = b.instructions !== a.instructions;
  const keys = Object.keys(SECTION_LABELS) as SectionKey[];
  const sections = keys.map((k) =>
    diffSection(k, b[k] as unknown as Record<string, unknown>, a[k] as unknown as Record<string, unknown>),
  );
  const changedSections = sections.filter((s) => s.changes.length > 0);
  const changeCount = changedSections.reduce((n, s) => n + s.changes.length, 0) + (instructionsChanged ? 1 : 0);
  return { instructions, instructionStats, instructionsChanged, sections, changedSections, changeCount, identical: changeCount === 0 };
}

// ----------------------------------------------------------------------------- value display

/** Human display of a policy/limit value (units where the field has one). */
export function formatFieldValue(section: SectionKey, field: string, value: Scalar): string {
  if (value === null || value === undefined || value === "") {
    if (section === "execution_limits") return "No limit";
    if (section === "model_policy" && field !== "planning_tier") return "Platform default";
    return "—";
  }
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (section === "execution_limits" && field === "max_cost_usd" && typeof value === "number") return usd(value);
  if (section === "execution_limits" && field === "max_duration_seconds" && typeof value === "number") return formatSeconds(value);
  if (section === "verification_policy" && field === "readback_delay_ms") return `${value} ms`;
  if (section === "model_policy" && field === "planning_tier") return String(value).charAt(0).toUpperCase() + String(value).slice(1);
  return String(value);
}

export function formatSeconds(total: number): string {
  if (total < 60) return `${total} s`;
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [d && `${d} d`, h && `${h} h`, m && `${m} min`, s && `${s} s`].filter(Boolean);
  return parts.join(" ");
}
