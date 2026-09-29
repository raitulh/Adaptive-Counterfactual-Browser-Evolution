import * as THREE from "three";
import { STAGE_PRESETS, type SystemStage } from "./stage";

export { mulberry32 } from "./random";

/**
 * Damped presentation levels shared by every layer of the scene. The scene root eases these toward
 * the current stage's preset each frame (frame-rate independent), and layers read them in their own
 * render loop — no React state changes per frame.
 */
export interface Levels {
  time: number;
  /** Damped progress within the current stage (0..1). */
  progress: number;
  core: number;
  orbit: number;
  links: number;
  graph: number;
  ring: number;
  memory: number;
  lattice: number;
}

export type LevelsRef = { current: Levels };

export const LEVEL_KEYS = ["core", "orbit", "links", "graph", "ring", "memory", "lattice"] as const;

export function initialLevels(stage: SystemStage): Levels {
  const p = STAGE_PRESETS[stage];
  return {
    time: 0,
    progress: 0,
    core: p.core * 0.4,
    orbit: 0,
    links: 0,
    graph: 0,
    ring: 0,
    memory: 0,
    lattice: 0,
  };
}

/** Exponential smoothing factor for a given rate (per second) and frame delta. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

let glowTexture: THREE.Texture | null = null;

/** A soft radial glow (white, tinted per use) — the scene's only texture, generated once. */
export function getGlowTexture(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.18, "rgba(255,255,255,0.55)");
    g.addColorStop(0.45, "rgba(255,255,255,0.14)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  glowTexture = new THREE.CanvasTexture(canvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

/** Points on a circle as a closed polyline with a 0..1 parameter attribute. */
export function circleGeometry(radius: number, segments: number): THREE.BufferGeometry {
  const pos = new Float32Array((segments + 1) * 3);
  const t = new Float32Array(segments + 1);
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * radius;
    pos[i * 3 + 1] = Math.sin(a) * radius;
    pos[i * 3 + 2] = 0;
    t[i] = i / segments;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aT", new THREE.BufferAttribute(t, 1));
  return g;
}

let ringTexture: THREE.Texture | null = null;

/** A thin circle outline (white, tinted per use) for tool and plan nodes. */
export function getRingTexture(): THREE.Texture {
  if (ringTexture) return ringTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.strokeStyle = "rgba(255,255,255,1)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
    ctx.stroke();
  }
  ringTexture = new THREE.CanvasTexture(canvas);
  ringTexture.colorSpace = THREE.SRGBColorSpace;
  return ringTexture;
}
