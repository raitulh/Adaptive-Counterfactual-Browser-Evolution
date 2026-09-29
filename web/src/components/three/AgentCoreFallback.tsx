/**
 * 2D Agent Core: an SVG/CSS rendering of the same system (core, tool orbit, verification ring,
 * plan graph, memory field) driven by the same stage model as the WebGL scene.
 *
 * Used before the 3D scene loads, when WebGL is unavailable, with reduced motion (static), Save-Data
 * or low-power devices. Hook-free, so it also renders in Server Components.
 */
import { cn } from "@/lib/utils";
import { mulberry32 } from "./random";
import {
  approvalGateOpen,
  graphNodeStates,
  PALETTE,
  STAGE_PRESETS,
  TOOL_NODES,
  verificationArc,
  type GraphNodeState,
  type SystemStage,
  type ToolNodeId,
} from "./stage";

export interface AgentCoreFallbackProps {
  stage: SystemStage;
  /** Coarse progress within the stage (0..1); re-render only when it changes meaningfully. */
  progress?: number;
  activeNodes?: readonly ToolNodeId[];
  /** CSS/SMIL motion; false renders a still frame (reduced motion). */
  animate?: boolean;
  labels?: boolean;
  /** Unique prefix for SVG ids when several instances share a page. */
  id?: string;
  className?: string;
}

const ORBIT = { rx: 312, ry: 96, tilt: -8 };

/** Round SVG coordinates so server and client serialize them identically. */
const r2 = (n: number) => Math.round(n * 100) / 100;
const RING_R = 206;

function orbitPoint(i: number, n: number) {
  const a = (i / n) * Math.PI * 2 + 0.35;
  const x = Math.cos(a) * ORBIT.rx;
  const y = Math.sin(a) * ORBIT.ry;
  const t = (ORBIT.tilt * Math.PI) / 180;
  return { x: r2(x * Math.cos(t) - y * Math.sin(t)), y: r2(x * Math.sin(t) + y * Math.cos(t)), front: Math.sin(a) > 0 };
}

const GRAPH = [
  { x: -158, y: -214 },
  { x: -96, y: -272 },
  { x: 22, y: -248 },
  { x: 146, y: -206 },
];
const GRAPH_ROOT = { x: 0, y: -64 };
const GRAPH_EDGES: Array<[number, number]> = [
  [-1, 0],
  [-1, 1],
  [0, 2],
  [1, 2],
  [2, 3],
];

const STATE_FILL: Record<GraphNodeState, string> = {
  hidden: PALETTE.fgSubtle,
  pending: PALETTE.fgMuted,
  running: PALETTE.accent,
  waiting_approval: PALETTE.warning,
  verifying: PALETTE.verify,
  completed: PALETTE.success,
};

// Memory particles: deterministic so server and client render the same markup.
const MEMORY = (() => {
  const rand = mulberry32(42);
  return Array.from({ length: 56 }, () => {
    const a = rand() * Math.PI * 2;
    const r = 0.72 + rand() * 0.34;
    const conf = Math.pow(rand(), 1.5);
    return {
      x: Math.cos(a) * 372 * r,
      y: Math.sin(a) * 118 * r + (rand() - 0.5) * 24,
      r: 0.9 + conf * 1.8,
      conf,
      verified: conf > 0.7 && rand() > 0.5,
    };
  });
})();

const TICKS = Array.from({ length: 72 }, (_, i) => {
  const a = (i / 72) * Math.PI * 2;
  const long = i % 6 === 0;
  const r0 = RING_R + 8;
  const r1 = RING_R + (long ? 20 : 13);
  return { x1: r2(Math.sin(a) * r0), y1: r2(-Math.cos(a) * r0), x2: r2(Math.sin(a) * r1), y2: r2(-Math.cos(a) * r1) };
});

/** Round style numbers so server and client serialize them identically. */
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function linkPath(x: number, y: number): string {
  const len = Math.hypot(x, y);
  const sx = (x / len) * 64;
  const sy = (y / len) * 64;
  const cx = (sx + x) / 2;
  const cy = (sy + y) / 2 - 70;
  return `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
}

function arcPath(r: number, fromDeg: number, toDeg: number): string {
  const p = (d: number) => {
    const a = ((d - 90) * Math.PI) / 180;
    return `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`;
  };
  return `M ${p(fromDeg)} A ${r} ${r} 0 0 1 ${p(toDeg)}`;
}

export function AgentCoreFallback({
  stage,
  progress = 0,
  activeNodes,
  animate = true,
  labels = true,
  id = "aos-core",
  className,
}: AgentCoreFallbackProps) {
  const preset = STAGE_PRESETS[stage];
  const active = new Set<string>(activeNodes ?? preset.active);
  const gateOpen = approvalGateOpen(stage, progress);
  const ring = verificationArc(stage, progress);
  const graph = graphNodeStates(stage, progress);
  const learning = stage === "learn";
  const t = (ms: number) => ({ transitionDuration: `${ms}ms` });

  return (
    <svg
      viewBox="-400 -400 800 800"
      className={cn("overflow-visible", className)}
      aria-hidden
      focusable="false"
      data-stage={stage}
    >
      <defs>
        <radialGradient id={`${id}-core`} cx="42%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#E9FEFF" />
          <stop offset="38%" stopColor={PALETTE.accent} />
          <stop offset="100%" stopColor="#1B8C93" />
        </radialGradient>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0%" stopColor={PALETTE.accent} stopOpacity="0.5" />
          <stop offset="35%" stopColor={PALETTE.accent} stopOpacity="0.14" />
          <stop offset="100%" stopColor={PALETTE.accent} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-fade`}>
          <stop offset="55%" stopColor="#fff" stopOpacity="1" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={`${id}-mask`}>
          <circle r="400" fill={`url(#${id}-fade)`} />
        </mask>
        <pattern id={`${id}-grid`} width="26" height="26" patternUnits="userSpaceOnUse" x="-13" y="-13">
          <circle cx="13" cy="13" r="0.9" fill={PALETTE.fgSubtle} />
        </pattern>
        <linearGradient id={`${id}-beam`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={PALETTE.accent} stopOpacity="0" />
          <stop offset="100%" stopColor={PALETTE.accent} stopOpacity="0.9" />
        </linearGradient>
      </defs>

      {/* Execution lattice */}
      <rect
        x="-400"
        y="-400"
        width="800"
        height="800"
        fill={`url(#${id}-grid)`}
        mask={`url(#${id}-mask)`}
        className="transition-opacity ease-out"
        style={{ opacity: r3(0.25 + preset.lattice * 0.45), ...t(900) }}
      />

      {/* Ambient light */}
      <circle
        r="330"
        fill={`url(#${id}-glow)`}
        className="transition-opacity"
        style={{ opacity: r3(0.35 + preset.core * 0.5), ...t(900) }}
      />

      {/* Memory field */}
      <g
        className="origin-center transition-transform ease-[cubic-bezier(0.16,1,0.3,1)] transform-fill"
        style={{ transform: `rotate(-8deg) scale(${learning ? 0.78 : 1})`, ...t(1200) }}
      >
        {MEMORY.map((m, i) => (
          <circle
            key={i}
            cx={m.x.toFixed(1)}
            cy={m.y.toFixed(1)}
            r={m.r.toFixed(2)}
            fill={learning && m.verified ? PALETTE.verify : m.conf > 0.5 ? PALETTE.fg : PALETTE.fgSubtle}
            className="transition-[opacity,fill]"
            style={{ opacity: r3((0.1 + m.conf * 0.6) * (0.3 + preset.memory * 0.7)), ...t(1000) }}
          />
        ))}
      </g>

      {/* Goal signal */}
      <path
        d="M -420 -330 Q -190 -300 -52 -38"
        fill="none"
        stroke={`url(#${id}-beam)`}
        strokeWidth="1.5"
        strokeDasharray="4 10"
        className={cn("transition-opacity", animate && "animate-dash")}
        style={{ opacity: r3(stage === "goal" ? 1 : stage === "idle" ? 0.35 : 0), ...t(700) }}
      />

      {/* Orbit */}
      <ellipse
        rx={ORBIT.rx}
        ry={ORBIT.ry}
        transform={`rotate(${ORBIT.tilt})`}
        fill="none"
        stroke="rgb(255 255 255 / 0.24)"
        strokeDasharray="1 5"
        className="transition-opacity"
        style={{ opacity: r3(0.3 + preset.orbit * 0.7), ...t(900) }}
      />

      {/* Links to active tools */}
      {TOOL_NODES.map((node, i) => {
        const p = orbitPoint(i, TOOL_NODES.length);
        const on = active.has(node.id);
        const gated = stage === "act" && node.id === "calendar" && !gateOpen;
        const color = gated ? PALETTE.warning : stage === "verify" && on ? PALETTE.verify : PALETTE.accent;
        const d = linkPath(p.x, p.y);
        return (
          <g
            key={node.id}
            className="transition-opacity"
            style={{ opacity: r3(on ? 0.35 + preset.links * 0.65 : 0.1 * preset.links), ...t(800) }}
          >
            <path d={d} fill="none" stroke={color} strokeOpacity="0.28" strokeWidth="1" />
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth="1.4"
              strokeDasharray="3 21"
              className={cn(animate && on && !gated && "animate-dash")}
            />
            {animate && on && !gated && (
              <circle r="2.6" fill={color}>
                <animateMotion dur={`${2.2 + (i % 3) * 0.4}s`} repeatCount="indefinite" path={d} />
              </circle>
            )}
          </g>
        );
      })}

      {/* Verification ring */}
      <g className="transition-opacity" style={{ opacity: r3(0.2 + preset.ring * 0.8), ...t(900) }}>
        <circle r={RING_R} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="2" />
        {TICKS.map((k, i) => (
          <line key={i} {...k} stroke="rgb(255 255 255 / 0.16)" strokeWidth="1" />
        ))}
        <circle
          r={RING_R}
          fill="none"
          stroke={ring.complete ? PALETTE.success : PALETTE.verify}
          strokeWidth="2.5"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${(ring.arc * 100).toFixed(2)} 100`}
          transform="rotate(-90)"
          className="transition-[stroke-dasharray,stroke] ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={t(1100)}
        />
        <path
          d={arcPath(RING_R + 28, 100, 140)}
          fill="none"
          stroke={PALETTE.recover}
          strokeWidth="2.5"
          strokeLinecap="round"
          className="transition-opacity"
          style={{ opacity: r3(ring.recover > 0.2 ? 0.9 : 0), ...t(500) }}
        />
      </g>

      {/* Computational shells */}
      <g className="transition-opacity" style={{ opacity: r3(0.4 + preset.core * 0.45), ...t(900) }}>
        <g className={cn(animate && "origin-center transform-fill motion-safe:animate-[spin_60s_linear_infinite]")}>
          <circle r="150" fill="none" stroke={PALETTE.accent} strokeOpacity="0.28" strokeDasharray="1 6" />
          <polygon
            points="0,-122 106,-61 106,61 0,122 -106,61 -106,-61"
            fill="none"
            stroke={PALETTE.fg}
            strokeOpacity="0.1"
          />
        </g>
        <g
          className={cn(
            animate && "origin-center transform-fill motion-safe:animate-[spin_90s_linear_infinite_reverse]",
          )}
        >
          <polygon points="0,-96 96,0 0,96 -96,0" fill="none" stroke={PALETTE.accent} strokeOpacity="0.2" />
          <circle r="120" fill="none" stroke={PALETTE.fg} strokeOpacity="0.07" strokeDasharray="30 12" />
        </g>
        <circle r="86" fill="none" stroke={PALETTE.accent} strokeOpacity="0.32" />
      </g>

      {/* Core */}
      <circle
        r="120"
        fill={`url(#${id}-glow)`}
        className="transition-opacity"
        style={{ opacity: r3(0.4 + preset.core * 0.5), ...t(900) }}
      />
      <circle
        r="58"
        fill={`url(#${id}-core)`}
        className="transition-[opacity]"
        style={{ opacity: r3(0.55 + Math.min(1, preset.core) * 0.45), ...t(900) }}
      />
      <g className="transition-opacity" style={{ opacity: r3(0.5 + Math.min(1, preset.core) * 0.5), ...t(900) }}>
        <ellipse rx="57" ry="15" fill="none" stroke="#E9FEFF" strokeOpacity="0.28" transform="rotate(-14)" />
        <ellipse rx="57" ry="15" fill="none" stroke="#E9FEFF" strokeOpacity="0.14" transform="rotate(52)" />
        <circle r="30" fill="none" stroke="#E9FEFF" strokeOpacity="0.18" />
        <circle cx="-14" cy="-16" r="10" fill="#E9FEFF" fillOpacity="0.55" />
      </g>
      {animate && (
        <circle
          r="58"
          fill="none"
          stroke={PALETTE.accent}
          strokeOpacity="0.55"
          className="origin-center transform-fill motion-safe:animate-pulse-ring"
        />
      )}

      {/* Plan graph */}
      <g className="transition-opacity" style={{ opacity: r3(preset.graph), ...t(800) }}>
        {GRAPH_EDGES.map(([from, to], e) => {
          const a = from < 0 ? GRAPH_ROOT : GRAPH[from];
          const b = GRAPH[to];
          const st = graph[to];
          return (
            <path
              key={e}
              d={`M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${(a.y + b.y) / 2 - 34} ${b.x} ${b.y}`}
              fill="none"
              stroke={STATE_FILL[st]}
              strokeOpacity={st === "hidden" ? 0 : from < 0 ? 0.22 : 0.55}
              strokeWidth={from < 0 ? 1 : 1.2}
              pathLength={1}
              strokeDasharray="1 1"
              strokeDashoffset={st === "hidden" ? 1 : 0}
              className="transition-[stroke-dashoffset,stroke,stroke-opacity] ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={t(1000)}
            />
          );
        })}
        {GRAPH.map((n, i) => {
          const st = graph[i];
          return (
            <g key={i} transform={`translate(${n.x} ${n.y})`}>
              <rect
                x="-6"
                y="-6"
                width="12"
                height="12"
                transform="rotate(45)"
                fill={STATE_FILL[st]}
                className="transition-[fill,opacity]"
                style={{ opacity: r3(st === "hidden" ? 0 : 1), ...t(600) }}
              />
              {st === "waiting_approval" && (
                <circle
                  r="13"
                  fill="none"
                  stroke={PALETTE.warning}
                  strokeOpacity="0.7"
                  className={cn(animate && "motion-safe:animate-signal")}
                />
              )}
            </g>
          );
        })}
      </g>

      {/* Tool nodes (drawn last so labels sit on top) */}
      {TOOL_NODES.map((node, i) => {
        const p = orbitPoint(i, TOOL_NODES.length);
        const on = active.has(node.id);
        const gated = stage === "act" && node.id === "calendar" && !gateOpen;
        const color = gated
          ? PALETTE.warning
          : on
            ? stage === "verify"
              ? PALETTE.verify
              : PALETTE.accent
            : PALETTE.fgSubtle;
        const lx = p.x * 1.1;
        const ly = p.y * 1.1 + (p.front ? 22 : -14);
        return (
          <g
            key={node.id}
            className="transition-opacity"
            style={{ opacity: r3(0.45 + preset.orbit * 0.55), ...t(800) }}
          >
            {on && (
              <circle cx={p.x} cy={p.y} r="11" fill={color} fillOpacity="0.14" stroke={color} strokeOpacity="0.45" />
            )}
            <circle cx={p.x} cy={p.y} r={on ? 4.5 : 3.2} fill={color} className="transition-[fill]" style={t(500)} />
            {labels && (
              <text
                x={r2(lx)}
                y={r2(ly)}
                textAnchor="middle"
                fill={on ? (gated ? PALETTE.warning : PALETTE.fg) : PALETTE.fgSubtle}
                fontSize="11.5"
                letterSpacing="2"
                stroke={PALETTE.bg}
                strokeWidth="4"
                strokeOpacity="0.85"
                paintOrder="stroke"
                className="font-mono uppercase"
              >
                {node.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
