/**
 * Decide how the system visualization renders on this device.
 *
 *  - WebGL scene, high quality: capable desktop GPUs.
 *  - WebGL scene, low quality: phones/tablets and mid-range devices (fewer particles, lower DPR,
 *    no labels on inactive nodes, simpler camera).
 *  - 2D fallback (SVG/CSS): no WebGL, a software renderer, reduced motion, Save-Data or
 *    low-power hardware. With reduced motion the fallback is static.
 *
 * Pure functions + a small browser probe, so the policy is unit-testable.
 */

export type VisualMode = "3d" | "2d";
export type VisualQuality = "high" | "low";
export type VisualReason =
  "capable" | "forced" | "webgl-unavailable" | "software-renderer" | "reduced-motion" | "save-data" | "low-power";

export interface DeviceCapabilities {
  webgl: boolean;
  softwareRenderer: boolean;
  reducedMotion: boolean;
  saveData: boolean;
  /** `navigator.deviceMemory` in GB (Chromium only), null when unknown. */
  deviceMemory: number | null;
  hardwareConcurrency: number | null;
  coarsePointer: boolean;
  viewportWidth: number;
}

export interface VisualPlan {
  mode: VisualMode;
  quality: VisualQuality;
  /** Whether anything should move at all (false with reduced motion). */
  animate: boolean;
  reason: VisualReason;
}

export type VisualOverride = "3d" | "2d" | null;

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;

export function isLowPower(c: Pick<DeviceCapabilities, "deviceMemory" | "hardwareConcurrency">): boolean {
  return (
    (c.deviceMemory !== null && c.deviceMemory <= 2) || (c.hardwareConcurrency !== null && c.hardwareConcurrency <= 2)
  );
}

export function qualityFor(c: DeviceCapabilities): VisualQuality {
  const constrained =
    c.viewportWidth < 768 ||
    c.coarsePointer ||
    (c.deviceMemory !== null && c.deviceMemory <= 4) ||
    (c.hardwareConcurrency !== null && c.hardwareConcurrency <= 4);
  return constrained ? "low" : "high";
}

export function planVisual(c: DeviceCapabilities, override: VisualOverride = null): VisualPlan {
  const quality = qualityFor(c);
  if (override === "2d") return { mode: "2d", quality, animate: !c.reducedMotion, reason: "forced" };
  // Reduced motion always wins, even over a forced mode.
  if (c.reducedMotion) return { mode: "2d", quality, animate: false, reason: "reduced-motion" };
  if (override === "3d" && c.webgl) return { mode: "3d", quality, animate: true, reason: "forced" };
  if (!c.webgl) return { mode: "2d", quality, animate: true, reason: "webgl-unavailable" };
  if (c.saveData) return { mode: "2d", quality, animate: true, reason: "save-data" };
  if (c.softwareRenderer) return { mode: "2d", quality, animate: true, reason: "software-renderer" };
  if (isLowPower(c)) return { mode: "2d", quality, animate: true, reason: "low-power" };
  return { mode: "3d", quality, animate: true, reason: "capable" };
}

/** `?visual=3d|2d` forces a mode (QA and screenshots); anything else is ignored. */
export function readOverride(search: string): VisualOverride {
  const value = new URLSearchParams(search).get("visual");
  return value === "3d" || value === "2d" ? value : null;
}

type GLLike = {
  getExtension(name: string): unknown;
  getParameter(p: number): unknown;
  RENDERER: number;
};

/** Try to create a WebGL context and identify software rasterizers. The probe context is released. */
export function probeWebGL(createCanvas: () => HTMLCanvasElement = () => document.createElement("canvas")): {
  webgl: boolean;
  softwareRenderer: boolean;
} {
  try {
    const canvas = createCanvas();
    // The scene uses three.js r18x, which requires WebGL 2.
    const gl = canvas.getContext("webgl2") as (GLLike & object) | null;
    if (!gl) return { webgl: false, softwareRenderer: false };
    let renderer = "";
    const debug = gl.getExtension("WEBGL_debug_renderer_info") as { UNMASKED_RENDERER_WEBGL: number } | null;
    try {
      renderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
    } catch {
      renderer = "";
    }
    (gl.getExtension("WEBGL_lose_context") as { loseContext(): void } | null)?.loseContext();
    return { webgl: true, softwareRenderer: SOFTWARE_RENDERER.test(renderer) };
  } catch {
    return { webgl: false, softwareRenderer: false };
  }
}

type NavigatorLike = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
};

export function readCapabilities(win: Window, probe: typeof probeWebGL = probeWebGL): DeviceCapabilities {
  const nav = win.navigator as NavigatorLike;
  const media = (q: string) => {
    try {
      return win.matchMedia(q).matches;
    } catch {
      return false;
    }
  };
  const gl = probe(() => win.document.createElement("canvas"));
  return {
    webgl: gl.webgl,
    softwareRenderer: gl.softwareRenderer,
    reducedMotion: media("(prefers-reduced-motion: reduce)"),
    saveData: Boolean(nav.connection?.saveData),
    deviceMemory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    hardwareConcurrency: typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
    coarsePointer: media("(pointer: coarse)"),
    viewportWidth: win.innerWidth,
  };
}
