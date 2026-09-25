"use client";

import { useSyncExternalStore } from "react";

export type WebGLCapability = "unknown" | "unsupported" | "low" | "full";

let cached: WebGLCapability | null = null;

/**
 * Detects hardware-accelerated WebGL. Software renderers are treated as
 * unsupported (`failIfMajorPerformanceCaveat`) so low-end devices get the
 * static visual instead of a janky canvas.
 */
export function detectWebGL(): WebGLCapability {
  if (cached) return cached;
  try {
    const canvas = document.createElement("canvas");
    const options: WebGLContextAttributes = { failIfMajorPerformanceCaveat: true };
    const context = canvas.getContext("webgl2", options) ?? canvas.getContext("webgl", options);
    if (!context) {
      cached = "unsupported";
    } else {
      const nav = navigator as Navigator & { deviceMemory?: number };
      const lowEnd = (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
      cached = lowEnd ? "low" : "full";
      context.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    cached = "unsupported";
  }
  return cached;
}

const noop = () => () => {};

export function useWebGLCapability(): WebGLCapability {
  return useSyncExternalStore(noop, detectWebGL, () => "unknown");
}
