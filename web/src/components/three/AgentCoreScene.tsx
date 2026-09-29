"use client";

/**
 * The Agent Core: a living execution engine rendered with React Three Fiber.
 *
 * Layers (back to front): task-stream lattice, memory field, the core (noise-displaced body,
 * computational shells, a dotted lattice sphere, flowing instruction rings), the verification ring,
 * the tool orbit and the plan graph. Everything is driven by presentation props only — `stage`,
 * `progress`, `activeNodes`, `quality` — eased per frame without React re-renders.
 *
 * Load with `next/dynamic` + `ssr: false` (see SystemVisual); never import it on the server.
 */
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { VisualQuality } from "./capabilities";
import { ExecutionGraph } from "./ExecutionGraph";
import {
  circleGeometry,
  damp,
  getGlowTexture,
  initialLevels,
  LEVEL_KEYS,
  mulberry32,
  type Levels,
  type LevelsRef,
} from "./levels";
import { MemoryField } from "./MemoryField";
import {
  CORE_FRAGMENT,
  CORE_VERTEX,
  DOTS_FRAGMENT,
  DOTS_VERTEX,
  FLOW_LINE_FRAGMENT,
  FLOW_LINE_VERTEX,
} from "./shaders";
import { PALETTE, STAGE_PRESETS, type ProgressRef, type SystemStage, type ToolNodeId } from "./stage";
import { ToolOrbit } from "./ToolOrbit";
import { VerificationRing } from "./VerificationRing";

export interface AgentCoreSceneProps {
  stage: SystemStage;
  /** 0..1 within the current stage; read every frame. */
  progress?: ProgressRef;
  /** Overrides the stage's default active tool nodes. */
  activeNodes?: readonly ToolNodeId[];
  quality: VisualQuality;
  /** False pauses rendering entirely (offscreen, hidden tab). */
  running: boolean;
  /** "auto": right of center on wide screens, upper third on narrow ones. */
  framing?: "auto" | "center";
  onReady?: () => void;
  /** Sustained low frame rate at the current quality. */
  onSlow?: () => void;
  onContextLost?: () => void;
}

// `<threeLine>` (THREE.Line; `<line>` is the SVG element in JSX).
extend({ ThreeLine: THREE.Line });

const LOOK: Partial<Record<SystemStage, [number, number, number]>> = {
  plan: [0, 0.95, 0],
  act: [0, 0.25, 0],
  learn: [0, -0.15, 0],
};

export default function AgentCoreScene(props: AgentCoreSceneProps) {
  const { quality, running, onContextLost } = props;
  return (
    <Canvas
      dpr={[1, quality === "high" ? 1.75 : 1.25]}
      frameloop={running ? "always" : "never"}
      gl={{ antialias: quality === "high", alpha: true, powerPreference: "default", stencil: false }}
      camera={{ fov: 32, near: 0.1, far: 60, position: [0, 0.7, 12.5] }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          onContextLost?.();
        });
      }}
      style={{ position: "absolute", inset: 0 }}
      aria-hidden
      tabIndex={-1}
    >
      <SceneRoot {...props} />
    </Canvas>
  );
}

function SceneRoot({ stage, progress, activeNodes, quality, framing = "auto", onReady, onSlow }: AgentCoreSceneProps) {
  const levels = useRef<Levels>(initialLevels(stage));
  const { camera, size, setDpr } = useThree();
  const pointer = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const perf = useRef({ frames: 0, acc: 0, samples: 0, ready: false, downgraded: false, lastW: 0, lastH: 0 });
  const vectors = useRef({
    look: new THREE.Vector3(),
    lookTarget: new THREE.Vector3(),
    camTarget: new THREE.Vector3(),
  });

  useEffect(() => {
    if (quality !== "high") return;
    const onMove = (e: PointerEvent) => {
      pointer.current.tx = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.ty = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [quality]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const L = levels.current;
    const preset = STAGE_PRESETS[stage];
    const k = damp(1.9, dt);
    for (const key of LEVEL_KEYS) L[key] += (preset[key] - L[key]) * k;
    L.time += dt;
    L.progress += ((progress?.current ?? 0) - L.progress) * damp(6, dt);

    // Framing: shift the projection so the core sits right of center (wide) or in the upper third (narrow).
    const cam = state.camera as THREE.PerspectiveCamera;
    const wide = size.width >= 1024;
    const p = perf.current;
    if (p.lastW !== size.width || p.lastH !== size.height) {
      p.lastW = size.width;
      p.lastH = size.height;
      if (framing === "center") cam.clearViewOffset();
      else if (wide) cam.setViewOffset(size.width, size.height, -size.width * 0.2, 0, size.width, size.height);
      else cam.setViewOffset(size.width, size.height, 0, size.height * 0.17, size.width, size.height);
      cam.updateProjectionMatrix();
    }

    // Camera: stage pose, a slow dolly through the stage, pointer parallax, narrow screens pull back.
    const ptr = pointer.current;
    ptr.x += (ptr.tx - ptr.x) * damp(2, dt);
    ptr.y += (ptr.ty - ptr.y) * damp(2, dt);
    const aspect = size.width / Math.max(1, size.height);
    const pullBack = (aspect < 1.1 ? 1 + (1.1 - aspect) * 0.95 : 1) * (framing === "center" ? 0.64 : 1);
    const [cx, cy, cz] = preset.camera;
    const { look, lookTarget, camTarget } = vectors.current;
    camTarget.set(cx + ptr.x * 0.45, cy - ptr.y * 0.3, (cz - L.progress * 0.5) * pullBack);
    camera.position.lerp(camTarget, damp(1.4, dt));
    lookTarget.set(...(LOOK[stage] ?? [0, 0, 0]));
    look.lerp(lookTarget, damp(1.4, dt));
    camera.lookAt(look);

    // Ready after the first rendered frames; then watch the frame rate.
    p.frames += 1;
    if (!p.ready && p.frames > 2) {
      p.ready = true;
      onReady?.();
    }
    if (p.frames > 90 && rawDt < 0.25) {
      p.acc += rawDt;
      p.samples += 1;
      if (p.samples >= 120) {
        const fps = p.samples / p.acc;
        p.acc = 0;
        p.samples = 0;
        if (fps < 40) {
          if (!p.downgraded && state.viewport.dpr > 1.01) {
            p.downgraded = true;
            setDpr(1);
          } else {
            onSlow?.();
          }
        }
      }
    }
  });

  const active = activeNodes ?? STAGE_PRESETS[stage].active;
  const high = quality === "high";

  return (
    <>
      <ExecutionGraph levels={levels} stage={stage} quality={quality} labels={high || size.width >= 900} />
      <MemoryField levels={levels} stage={stage} quality={quality} />
      <Core levels={levels} stage={stage} quality={quality} />
      <VerificationRing levels={levels} stage={stage} />
      <ToolOrbit levels={levels} stage={stage} active={active} quality={quality} labels={high ? "all" : "active"} />
    </>
  );
}

function fibonacciSphere(count: number, radius: number): Float32Array {
  const out = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = golden * i;
    out.set([Math.cos(t) * r * radius, y * radius, Math.sin(t) * r * radius], i * 3);
  }
  return out;
}

const RINGS = [
  { radius: 1.36, rotation: [1.15, 0.2, 0.3] as const, speed: 0.22, dashes: 3, color: PALETTE.accent },
  { radius: 1.64, rotation: [-0.85, 0.55, 0] as const, speed: -0.16, dashes: 2, color: PALETTE.fg },
  { radius: 2.02, rotation: [1.42, -0.2, 0.9] as const, speed: 0.1, dashes: 4, color: PALETTE.accent },
];

/** The core body, its computational shells, instruction rings and the goal signal. */
function Core({ levels, stage, quality }: { levels: LevelsRef; stage: SystemStage; quality: VisualQuality }) {
  const high = quality === "high";
  const body = useRef<THREE.Mesh>(null);
  const inner = useRef<THREE.LineSegments>(null);
  const outer = useRef<THREE.LineSegments>(null);
  const dots = useRef<THREE.Points>(null);
  const glow = useRef<THREE.Sprite>(null);
  const halo = useRef<THREE.Sprite>(null);
  const rings = useRef<Array<THREE.Line | null>>([]);
  const beam = useRef<THREE.LineSegments>(null);
  const local = useRef({ goal: 0 });

  const built = useMemo(() => {
    const accent = new THREE.Color(PALETTE.accent);
    const bodyGeo = new THREE.IcosahedronGeometry(0.82, high ? 3 : 2);
    const bodyMat = new THREE.ShaderMaterial({
      vertexShader: CORE_VERTEX,
      fragmentShader: CORE_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uAmp: { value: 1 },
        uIntensity: { value: 1 },
        uColor: { value: accent.clone() },
        uDeep: { value: new THREE.Color(PALETTE.accentStrong).multiplyScalar(0.16) },
        // The brand mark's inner highlight.
        uHot: { value: new THREE.Color("#e9feff") },
      },
    });
    const innerGeo = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.16, 1));
    const innerMat = new THREE.LineBasicMaterial({
      color: PALETTE.accent,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const outerGeo = new THREE.EdgesGeometry(new THREE.OctahedronGeometry(1.55, 0));
    const outerMat = new THREE.LineBasicMaterial({
      color: PALETTE.fg,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const dotCount = high ? 380 : 170;
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute("position", new THREE.BufferAttribute(fibonacciSphere(dotCount, 1.88), 3));
    const rand = mulberry32(3);
    dotGeo.setAttribute(
      "aSeed",
      new THREE.BufferAttribute(
        Float32Array.from({ length: dotCount }, () => rand()),
        1,
      ),
    );
    const dotMat = new THREE.ShaderMaterial({
      vertexShader: DOTS_VERTEX,
      fragmentShader: DOTS_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: high ? 2.2 : 2.6 },
        uPixelRatio: { value: 1 },
        uColor: { value: accent.clone().lerp(new THREE.Color(PALETTE.fg), 0.5) },
        uOpacity: { value: 0 },
      },
    });

    const ringGeos = RINGS.map((r) => circleGeometry(r.radius, high ? 256 : 128));
    const ringMats = RINGS.map(
      (r) =>
        new THREE.ShaderMaterial({
          vertexShader: FLOW_LINE_VERTEX,
          fragmentShader: FLOW_LINE_FRAGMENT,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uColor: { value: new THREE.Color(r.color) },
            uOpacity: { value: 0 },
            uTime: { value: 0 },
            uSpeed: { value: r.speed },
            uDashes: { value: r.dashes },
            uBase: { value: 0.08 },
          },
        }),
    );

    // The goal enters from the upper left and lands in the core.
    const beamSeg = 48;
    const from = new THREE.Vector3(-7.5, 4.2, 2.5);
    const to = new THREE.Vector3(0, 0, 0);
    const ctrl = new THREE.Vector3(-3.2, 3.6, 1.8);
    const curve = new THREE.QuadraticBezierCurve3(from, ctrl, to);
    const pts = curve.getPoints(beamSeg);
    const beamPos = new Float32Array(beamSeg * 6);
    const beamT = new Float32Array(beamSeg * 2);
    for (let s = 0; s < beamSeg; s++) {
      beamPos.set([pts[s].x, pts[s].y, pts[s].z, pts[s + 1].x, pts[s + 1].y, pts[s + 1].z], s * 6);
      beamT[s * 2] = s / beamSeg;
      beamT[s * 2 + 1] = (s + 1) / beamSeg;
    }
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute("position", new THREE.BufferAttribute(beamPos, 3));
    beamGeo.setAttribute("aT", new THREE.BufferAttribute(beamT, 1));
    const beamMat = new THREE.ShaderMaterial({
      vertexShader: FLOW_LINE_VERTEX,
      fragmentShader: FLOW_LINE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: accent.clone() },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uSpeed: { value: 0.55 },
        uDashes: { value: 1.2 },
        uBase: { value: 0.1 },
      },
    });

    const glowMat = new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color: accent.clone(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
    });
    const haloMat = glowMat.clone();
    return {
      bodyGeo,
      bodyMat,
      innerGeo,
      innerMat,
      outerGeo,
      outerMat,
      dotGeo,
      dotMat,
      ringGeos,
      ringMats,
      beamGeo,
      beamMat,
      glowMat,
      haloMat,
    };
  }, [high]);

  useEffect(
    () => () => {
      const b = built;
      [b.bodyGeo, b.innerGeo, b.outerGeo, b.dotGeo, b.beamGeo, ...b.ringGeos].forEach((g) => g.dispose());
      [b.bodyMat, b.innerMat, b.outerMat, b.dotMat, b.beamMat, b.glowMat, b.haloMat, ...b.ringMats].forEach((m) =>
        m.dispose(),
      );
    },
    [built],
  );

  useFrame((state, dt) => {
    const L = levels.current;
    const t = L.time;
    const energy = L.core;
    const s = local.current;
    s.goal += ((stage === "goal" ? 1 : stage === "idle" ? 0.35 : 0) - s.goal) * damp(2, dt);

    if (body.current) {
      const u = (body.current.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = t;
      u.uIntensity.value = 0.35 + energy * 0.72;
      u.uAmp.value = 0.6 + energy * 0.6;
      body.current.rotation.y = t * 0.08;
      const breathe = 1 + Math.sin(t * 1.3) * 0.012 * energy;
      body.current.scale.setScalar(breathe);
    }
    if (inner.current) {
      inner.current.rotation.set(t * 0.05, t * 0.11, 0);
      (inner.current.material as THREE.LineBasicMaterial).opacity = 0.2 * energy;
    }
    if (outer.current) {
      outer.current.rotation.set(-t * 0.03, -t * 0.06, t * 0.02);
      (outer.current.material as THREE.LineBasicMaterial).opacity = 0.085 * Math.max(energy, 0.4);
    }
    if (dots.current) {
      dots.current.rotation.y = t * 0.025;
      const u = (dots.current.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = t;
      u.uOpacity.value = 0.5 * Math.max(energy, 0.3);
      u.uPixelRatio.value = state.viewport.dpr;
    }
    rings.current.forEach((ring, i) => {
      if (!ring) return;
      ring.rotation.z = t * RINGS[i].speed * 0.3;
      const u = (ring.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = t;
      u.uOpacity.value = 0.55 * energy;
    });
    if (beam.current) {
      const u = (beam.current.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = t;
      u.uOpacity.value = s.goal * 0.9;
    }
    if (glow.current) {
      (glow.current.material as THREE.SpriteMaterial).opacity = 0.42 * energy;
      glow.current.scale.setScalar(4.2 + energy * 1.2 + Math.sin(t * 1.3) * 0.08);
    }
    if (halo.current) {
      (halo.current.material as THREE.SpriteMaterial).opacity = 0.1 * energy + s.goal * 0.08;
      halo.current.scale.setScalar(11);
    }
  });

  return (
    <group>
      <sprite ref={halo} material={built.haloMat} renderOrder={-1} />
      <sprite ref={glow} material={built.glowMat} />
      <mesh ref={body} geometry={built.bodyGeo} material={built.bodyMat} />
      <lineSegments ref={inner} geometry={built.innerGeo} material={built.innerMat} />
      <lineSegments ref={outer} geometry={built.outerGeo} material={built.outerMat} />
      <points ref={dots} geometry={built.dotGeo} material={built.dotMat} />
      {RINGS.map((r, i) => (
        <group key={i} rotation={[...r.rotation]}>
          <threeLine
            ref={(el: THREE.Line | null) => {
              rings.current[i] = el;
            }}
            geometry={built.ringGeos[i]}
            material={built.ringMats[i]}
          />
        </group>
      ))}
      <lineSegments ref={beam} geometry={built.beamGeo} material={built.beamMat} frustumCulled={false} />
    </group>
  );
}
