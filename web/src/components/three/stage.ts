/**
 * Presentation model shared by the 3D scene and its 2D fallback. Scenes receive only these
 * normalized props (a stage, a progress value, which tool nodes are active) — never API data.
 */

/** Narrative stages. `dormant`/`idle` frame the story; the rest follow the lifecycle. */
export type SystemStage = "dormant" | "idle" | "goal" | "plan" | "act" | "verify" | "learn";

export const LOOP_STAGES = ["goal", "plan", "act", "verify", "learn"] as const satisfies readonly SystemStage[];

/** Mutable progress (0..1 within the current stage) read inside render loops without re-rendering React. */
export interface ProgressRef {
  current: number;
}

export const TOOL_NODES = [
  { id: "gmail", label: "Gmail" },
  { id: "calendar", label: "Calendar" },
  { id: "drive", label: "Drive" },
  { id: "web", label: "Web" },
  { id: "browser", label: "Browser" },
  { id: "memory", label: "Memory" },
  { id: "mcp", label: "MCP" },
  { id: "files", label: "Files" },
  { id: "search", label: "Search" },
] as const;

export type ToolNodeId = (typeof TOOL_NODES)[number]["id"];

/**
 * Design tokens mirrored for WebGL (which cannot read CSS variables). Keep in sync with
 * `src/app/globals.css` @theme — these are the same colors, not new ones.
 */
export const PALETTE = {
  bg: "#07080a",
  fg: "#eceef2",
  fgMuted: "#a1a7b3",
  fgSubtle: "#7d8594",
  accent: "#5ce1e6",
  accentStrong: "#22c4cc",
  verify: "#a99bff",
  warning: "#f5b84a",
  recover: "#fb9a4b",
  success: "#3fd69a",
} as const;

export interface StagePreset {
  /** Core energy (0..1.3). */
  core: number;
  orbit: number;
  links: number;
  /** Execution graph visibility. */
  graph: number;
  /** Verification ring presence (the arc itself is driven by progress in `verify`). */
  ring: number;
  memory: number;
  /** Background lattice / task streams. */
  lattice: number;
  active: readonly ToolNodeId[];
  camera: readonly [number, number, number];
}

export const STAGE_PRESETS: Record<SystemStage, StagePreset> = {
  dormant: { core: 0.35, orbit: 0.2, links: 0, graph: 0, ring: 0, memory: 0.18, lattice: 0.15, active: [], camera: [0, 0.4, 13] },
  idle: {
    core: 1,
    orbit: 0.9,
    links: 0.55,
    graph: 0,
    ring: 0.4,
    memory: 0.5,
    lattice: 0.45,
    active: ["calendar", "gmail", "memory"],
    camera: [0, 0.7, 11.5],
  },
  goal: { core: 1.3, orbit: 0.45, links: 0.12, graph: 0, ring: 0.15, memory: 0.3, lattice: 0.3, active: [], camera: [0, 0.25, 9.4] },
  plan: {
    core: 1,
    orbit: 0.6,
    links: 0.3,
    graph: 1,
    ring: 0.2,
    memory: 0.35,
    lattice: 0.7,
    active: ["calendar", "memory"],
    camera: [-0.9, 1.9, 10.6],
  },
  act: {
    core: 1.1,
    orbit: 1,
    links: 1,
    graph: 0.8,
    ring: 0.3,
    memory: 0.35,
    lattice: 0.55,
    active: ["calendar", "gmail"],
    camera: [1.3, 0.9, 10.8],
  },
  verify: {
    core: 0.9,
    orbit: 0.7,
    links: 0.45,
    graph: 0.6,
    ring: 1,
    memory: 0.3,
    lattice: 0.35,
    active: ["calendar", "gmail"],
    camera: [0, 0.2, 8.8],
  },
  learn: {
    core: 1,
    orbit: 0.55,
    links: 0.3,
    graph: 0.25,
    ring: 0.6,
    memory: 1,
    lattice: 0.3,
    active: ["memory"],
    camera: [0, 3.6, 11.6],
  },
};

/** Step status used by the execution graph (a subset of the backend's StepStatus, for display only). */
export type GraphNodeState = "hidden" | "pending" | "running" | "waiting_approval" | "verifying" | "completed";

export const GRAPH_NODES = [
  { key: "find_slot", label: "calendar.find_free_slots" },
  { key: "find_contact", label: "contacts.lookup" },
  { key: "create_meeting", label: "calendar.create_event" },
  { key: "send_confirmation", label: "gmail.send" },
] as const;

/**
 * The plan graph's node states for a stage and progress: the narrative of one run
 * (reads → approval → write → read-back → e-mail → verified) told by scroll position.
 */
export function graphNodeStates(stage: SystemStage, progress: number): GraphNodeState[] {
  const p = Math.min(1, Math.max(0, progress));
  switch (stage) {
    case "plan":
      return [0.08, 0.2, 0.34, 0.48].map((t) => (p >= t ? "pending" : "hidden"));
    case "act": {
      const reads: GraphNodeState = p < 0.22 ? "running" : "completed";
      const meeting: GraphNodeState = p < 0.22 ? "pending" : p < 0.55 ? "waiting_approval" : "running";
      return [reads, reads, meeting, "pending"];
    }
    case "verify": {
      const meeting: GraphNodeState = p < 0.35 ? "verifying" : "completed";
      const mail: GraphNodeState =
        p < 0.35 ? "pending" : p < 0.5 ? "waiting_approval" : p < 0.65 ? "running" : p < 0.85 ? "verifying" : "completed";
      return ["completed", "completed", meeting, mail];
    }
    case "learn":
      return ["completed", "completed", "completed", "completed"];
    default:
      return ["hidden", "hidden", "hidden", "hidden"];
  }
}

/** In the act stage the calendar write waits for a human before it runs. */
export function approvalGateOpen(stage: SystemStage, progress: number): boolean {
  if (stage !== "act") return true;
  return progress >= 0.55;
}

/** Verification ring arc (0..1) and whether it reads as verified completion. */
export function verificationArc(stage: SystemStage, progress: number): { arc: number; complete: boolean; recover: number } {
  const p = Math.min(1, Math.max(0, progress));
  switch (stage) {
    case "verify": {
      // A brief reconciliation (orange) while the first read-back settles, then the sweep completes.
      const recover = p > 0.18 && p < 0.42 ? Math.sin(((p - 0.18) / 0.24) * Math.PI) : 0;
      return { arc: Math.min(1, p / 0.85), complete: p >= 0.85, recover };
    }
    case "learn":
      return { arc: 1, complete: true, recover: 0 };
    case "act":
      return { arc: 0.08 + p * 0.12, complete: false, recover: 0 };
    case "idle":
      return { arc: 0.32, complete: false, recover: 0 };
    default:
      return { arc: 0, complete: false, recover: 0 };
  }
}
