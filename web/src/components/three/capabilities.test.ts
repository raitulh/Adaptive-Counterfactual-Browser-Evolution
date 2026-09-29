import { describe, expect, it, vi } from "vitest";
import {
  planVisual,
  probeWebGL,
  qualityFor,
  readCapabilities,
  readOverride,
  type DeviceCapabilities,
} from "./capabilities";

const capable: DeviceCapabilities = {
  webgl: true,
  softwareRenderer: false,
  reducedMotion: false,
  saveData: false,
  deviceMemory: 8,
  hardwareConcurrency: 8,
  coarsePointer: false,
  viewportWidth: 1440,
};

describe("planVisual", () => {
  it("renders the full 3D scene on capable desktops", () => {
    expect(planVisual(capable)).toEqual({ mode: "3d", quality: "high", animate: true, reason: "capable" });
  });

  it("falls back to a static 2D visual with reduced motion", () => {
    expect(planVisual({ ...capable, reducedMotion: true })).toMatchObject({
      mode: "2d",
      animate: false,
      reason: "reduced-motion",
    });
  });

  it("keeps reduced motion even when 3D is forced", () => {
    expect(planVisual({ ...capable, reducedMotion: true }, "3d")).toMatchObject({ mode: "2d", animate: false });
  });

  it("uses the animated 2D visual without WebGL", () => {
    expect(planVisual({ ...capable, webgl: false })).toMatchObject({
      mode: "2d",
      animate: true,
      reason: "webgl-unavailable",
    });
    expect(planVisual({ ...capable, webgl: false }, "3d")).toMatchObject({ mode: "2d" });
  });

  it("respects Save-Data, software rasterizers and low-power hardware", () => {
    expect(planVisual({ ...capable, saveData: true }).reason).toBe("save-data");
    expect(planVisual({ ...capable, softwareRenderer: true }).reason).toBe("software-renderer");
    expect(planVisual({ ...capable, deviceMemory: 2 }).reason).toBe("low-power");
    expect(planVisual({ ...capable, hardwareConcurrency: 2 }).reason).toBe("low-power");
    expect(planVisual({ ...capable, deviceMemory: null, hardwareConcurrency: null }).mode).toBe("3d");
  });

  it("reduces quality on phones, touch devices and mid-range hardware", () => {
    expect(qualityFor({ ...capable, viewportWidth: 390 })).toBe("low");
    expect(qualityFor({ ...capable, coarsePointer: true })).toBe("low");
    expect(qualityFor({ ...capable, deviceMemory: 4 })).toBe("low");
    expect(qualityFor({ ...capable, hardwareConcurrency: 4 })).toBe("low");
    expect(planVisual({ ...capable, viewportWidth: 390, coarsePointer: true })).toMatchObject({
      mode: "3d",
      quality: "low",
    });
  });

  it("honours a forced 2D mode", () => {
    expect(planVisual(capable, "2d")).toMatchObject({ mode: "2d", animate: true, reason: "forced" });
  });
});

describe("readOverride", () => {
  it("accepts only known values", () => {
    expect(readOverride("?visual=3d")).toBe("3d");
    expect(readOverride("?visual=2d&x=1")).toBe("2d");
    expect(readOverride("?visual=webgpu")).toBeNull();
    expect(readOverride("")).toBeNull();
  });
});

function fakeCanvas(ctx: unknown) {
  return { getContext: vi.fn((kind: string) => (kind === "webgl2" ? ctx : null)) } as unknown as HTMLCanvasElement;
}

describe("probeWebGL", () => {
  it("reports no WebGL when a WebGL 2 context cannot be created", () => {
    expect(probeWebGL(() => fakeCanvas(null))).toEqual({ webgl: false, softwareRenderer: false });
  });

  it("detects software renderers and releases the probe context", () => {
    const loseContext = vi.fn();
    const gl = {
      RENDERER: 0x1f01,
      getExtension: (name: string) =>
        name === "WEBGL_debug_renderer_info"
          ? { UNMASKED_RENDERER_WEBGL: 0x9246 }
          : name === "WEBGL_lose_context"
            ? { loseContext }
            : null,
      getParameter: (p: number) =>
        p === 0x9246 ? "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)" : "",
    };
    expect(probeWebGL(() => fakeCanvas(gl))).toEqual({ webgl: true, softwareRenderer: true });
    expect(loseContext).toHaveBeenCalled();
  });

  it("accepts hardware renderers", () => {
    const gl = { RENDERER: 1, getExtension: () => null, getParameter: () => "Apple M2" };
    expect(probeWebGL(() => fakeCanvas(gl))).toEqual({ webgl: true, softwareRenderer: false });
  });

  it("treats a throwing context as unavailable", () => {
    const canvas = {
      getContext: () => {
        throw new Error("blocked");
      },
    } as unknown as HTMLCanvasElement;
    expect(probeWebGL(() => canvas)).toEqual({ webgl: false, softwareRenderer: false });
  });
});

describe("readCapabilities", () => {
  it("reads media queries, Save-Data and hardware hints from the window", () => {
    const matches = new Set(["(prefers-reduced-motion: reduce)", "(pointer: coarse)"]);
    const win = {
      navigator: { deviceMemory: 4, hardwareConcurrency: 6, connection: { saveData: true } },
      matchMedia: (q: string) => ({ matches: matches.has(q) }),
      document: { createElement: () => fakeCanvas(null) },
      innerWidth: 390,
    } as unknown as Window;
    const caps = readCapabilities(win, () => ({ webgl: true, softwareRenderer: false }));
    expect(caps).toEqual({
      webgl: true,
      softwareRenderer: false,
      reducedMotion: true,
      saveData: true,
      deviceMemory: 4,
      hardwareConcurrency: 6,
      coarsePointer: true,
      viewportWidth: 390,
    });
    expect(planVisual(caps)).toMatchObject({ mode: "2d", animate: false });
  });
});
