"use client";

import * as React from "react";
import type { MemoryOut } from "@/lib/api";
import { cn } from "@/lib/utils";
import { freshnessWindow, metaForType, presentMemory } from "./presentation";

const DOT_FILL = {
  fresh: "fill-success",
  stale: "fill-warning",
  unverified: "fill-recover",
} as const;

const DOT_STROKE = {
  fresh: "stroke-success",
  stale: "stroke-warning",
  unverified: "stroke-recover",
} as const;

/** Deterministic 0..1 jitter from an id so dots don't jump between renders. */
function hash01(id: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

/**
 * "Memory field": each loaded memory is a dot. Its sector is its type, its distance from the core
 * is how much of its freshness window has elapsed (fresh near the core, stale at the rim), its
 * size is importance and its opacity is confidence. Unverified/conflicted dots are hollow and
 * dashed. Purely a visual summary — the list next to it carries the same information in text.
 */
export function MemoryField({ memories, now, className }: { memories: MemoryOut[]; now: number; className?: string }) {
  const size = 240;
  const c = size / 2;
  const rMax = c - 44;
  const rMin = 16;

  const types = React.useMemo(() => {
    const seen: string[] = [];
    for (const m of memories) if (!seen.includes(m.memory_type)) seen.push(m.memory_type);
    return seen;
  }, [memories]);

  const counts = React.useMemo(() => {
    const out = { fresh: 0, stale: 0, unverified: 0 };
    for (const m of memories) out[m.freshness] += 1;
    return out;
  }, [memories]);

  const sector = (2 * Math.PI) / Math.max(1, types.length);
  const summary = `${memories.length} memories loaded: ${counts.fresh} fresh, ${counts.stale} stale, ${counts.unverified} unverified, across ${types.length} ${types.length === 1 ? "type" : "types"}.`;

  return (
    <figure className={cn("flex flex-col items-center gap-3", className)}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="w-full max-w-[240px] overflow-visible"
        role="img"
        aria-label={`Memory field. ${summary}`}
      >
        <defs>
          <radialGradient id="memory-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgb(92 225 230 / 0.35)" />
            <stop offset="100%" stopColor="rgb(92 225 230 / 0)" />
          </radialGradient>
        </defs>
        {/* Guide rings: fresh core → stale rim */}
        {[0.33, 0.66, 1].map((f) => (
          <circle
            key={f}
            cx={c}
            cy={c}
            r={rMin + (rMax - rMin) * f}
            fill="none"
            className="stroke-white/[0.06]"
            strokeDasharray={f === 1 ? "2 4" : undefined}
          />
        ))}
        <circle cx={c} cy={c} r={30} fill="url(#memory-core)" />
        <circle cx={c} cy={c} r={3} className="fill-accent" />
        {/* Sector dividers + labels */}
        {types.length > 1 &&
          types.map((t, i) => {
            const a = i * sector - Math.PI / 2;
            return (
              <line
                key={`div-${t}`}
                x1={c + Math.cos(a) * rMin}
                y1={c + Math.sin(a) * rMin}
                x2={c + Math.cos(a) * (rMax + 4)}
                y2={c + Math.sin(a) * (rMax + 4)}
                className="stroke-white/[0.05]"
              />
            );
          })}
        {types.map((t, i) => {
          const a = (i + 0.5) * sector - Math.PI / 2;
          const x = c + Math.cos(a) * (rMax + 14);
          const y = c + Math.sin(a) * (rMax + 12);
          return (
            <text
              key={`label-${t}`}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-fg-subtle text-[9px] tracking-wider uppercase"
            >
              {metaForType(t).label}
            </text>
          );
        })}
        {memories.map((m) => {
          const idx = types.indexOf(m.memory_type);
          const w = freshnessWindow(m.memory_type, m.last_verified_at, now);
          const p = presentMemory(m);
          const used = m.freshness === "stale" ? 1 : w.used;
          const radius = rMin + 8 + (rMax - rMin - 8) * Math.sqrt(used) * (0.9 + 0.1 * hash01(m.id, 3));
          const angle = (idx + 0.12 + 0.76 * hash01(m.id)) * sector - Math.PI / 2;
          const x = c + Math.cos(angle) * radius;
          const y = c + Math.sin(angle) * radius;
          const r = 2.5 + m.importance * 4;
          const hollow = m.freshness === "unverified" || m.status === "conflicted";
          return (
            <circle
              key={m.id}
              cx={x}
              cy={y}
              r={r}
              className={cn(
                hollow ? "fill-transparent" : DOT_FILL[m.freshness],
                DOT_STROKE[m.freshness],
                "transition-opacity duration-300",
              )}
              strokeWidth={hollow ? 1.2 : 0}
              strokeDasharray={hollow ? "2 1.5" : undefined}
              opacity={p.uncertain && !hollow ? 0.55 : 0.35 + 0.65 * m.confidence}
            >
              <title>{`${metaForType(m.memory_type).label} · ${p.freshness.label} · ${Math.round(m.confidence * 100)}% confident — ${m.content.slice(0, 80)}`}</title>
            </circle>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-2xs text-fg-subtle">
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full bg-success" aria-hidden /> Fresh {counts.fresh}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full bg-warning" aria-hidden /> Stale {counts.stale}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full border border-dashed border-recover" aria-hidden /> Unverified{" "}
          {counts.unverified}
        </span>
      </figcaption>
    </figure>
  );
}
