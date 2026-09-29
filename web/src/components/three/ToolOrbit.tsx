"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { VisualQuality } from "./capabilities";
import { labelTexture } from "./label-texture";
import { damp, getGlowTexture, getRingTexture, type LevelsRef } from "./levels";
import { approvalGateOpen, PALETTE, TOOL_NODES, type SystemStage, type ToolNodeId } from "./stage";

const LINK_VERTEX = /* glsl */ `
attribute float aT;
attribute float aLink;
uniform float uAct[9];
uniform vec3 uCol[9];
varying float vT;
varying float vAct;
varying vec3 vCol;
void main() {
  int i = int(aLink + 0.5);
  vAct = uAct[i];
  vCol = uCol[i];
  vT = aT;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const LINK_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
varying float vT;
varying float vAct;
varying vec3 vCol;
void main() {
  float phase = fract(vT * 1.6 - uTime * 0.5);
  float comet = pow(phase, 9.0);
  float fade = smoothstep(0.0, 0.14, vT) * smoothstep(1.0, 0.9, vT);
  float a = uOpacity * fade * (0.04 + 0.26 * vAct + comet * vAct * 1.1);
  gl_FragColor = vec4(vCol * (0.65 + comet * 0.9), a);
}
`;

export const ORBIT_RADIUS = 3.05;
const TILT: [number, number, number] = [-1.2, 0, 0.1];
const LIFT = 0.95;

const N = TOOL_NODES.length;

function bezier(out: THREE.Vector3, a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, t: number) {
  const u = 1 - t;
  out.set(
    u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    u * u * a.z + 2 * u * t * c.z + t * t * b.z,
  );
  return out;
}

export interface ToolOrbitProps {
  levels: LevelsRef;
  stage: SystemStage;
  active: readonly ToolNodeId[];
  quality: VisualQuality;
  /** Which labels to draw: all nodes, only active ones, or none. */
  labels: "all" | "active" | "none";
}

/**
 * Tools on a tilted orbit around the core, linked by arcs that carry light toward the tools in use.
 * In the act stage the calendar link holds amber (waiting for a human) until the approval gate opens.
 */
export function ToolOrbit({ levels, stage, active, quality, labels }: ToolOrbitProps) {
  const seg = quality === "high" ? 22 : 14;
  const nodes = useRef<Array<THREE.Group | null>>([]);
  const cores = useRef<Array<THREE.Mesh | null>>([]);
  const glows = useRef<Array<THREE.Sprite | null>>([]);
  const rings = useRef<Array<THREE.Sprite | null>>([]);
  const labelSprites = useRef<Array<THREE.Sprite | null>>([]);
  const linkLines = useRef<THREE.LineSegments>(null);
  const pulsePoints = useRef<THREE.Points>(null);
  const activation = useRef(new Float32Array(N));
  const scratch = useRef({
    a: new THREE.Vector3(),
    b: new THREE.Vector3(),
    c: new THREE.Vector3(),
    p: new THREE.Vector3(),
    q: new THREE.Vector3(),
  });

  const palette = useMemo(
    () => ({
      idle: new THREE.Color(PALETTE.fgSubtle),
      accent: new THREE.Color(PALETTE.accent),
      warning: new THREE.Color(PALETTE.warning),
      verify: new THREE.Color(PALETTE.verify),
      label: new THREE.Color(PALETTE.fg),
    }),
    [],
  );

  const { linkGeo, linkMat, pulseGeo, pulseMat, nodeGeo, glowMat } = useMemo(() => {
    const vertsPerLink = seg * 2;
    const linkGeo = new THREE.BufferGeometry();
    const aT = new Float32Array(N * vertsPerLink);
    const aLink = new Float32Array(N * vertsPerLink);
    for (let l = 0; l < N; l++) {
      for (let s = 0; s < seg; s++) {
        const o = l * vertsPerLink + s * 2;
        aT[o] = s / seg;
        aT[o + 1] = (s + 1) / seg;
        aLink[o] = aLink[o + 1] = l;
      }
    }
    linkGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * vertsPerLink * 3), 3));
    linkGeo.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
    linkGeo.setAttribute("aLink", new THREE.BufferAttribute(aLink, 1));
    const linkMat = new THREE.ShaderMaterial({
      vertexShader: LINK_VERTEX,
      fragmentShader: LINK_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uAct: { value: new Float32Array(N) },
        uCol: { value: Array.from({ length: N }, () => new THREE.Color(PALETTE.accent)) },
      },
    });
    const pulseGeo = new THREE.BufferGeometry();
    pulseGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    pulseGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    const pulseMat = new THREE.PointsMaterial({
      size: 0.16,
      map: getGlowTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const nodeGeo = new THREE.SphereGeometry(0.062, quality === "high" ? 20 : 12, quality === "high" ? 14 : 8);
    const glowMat = new THREE.SpriteMaterial({
      map: getGlowTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { linkGeo, linkMat, pulseGeo, pulseMat, nodeGeo, glowMat };
  }, [seg, quality]);

  useEffect(
    () => () => {
      linkGeo.dispose();
      linkMat.dispose();
      pulseGeo.dispose();
      pulseMat.dispose();
      nodeGeo.dispose();
      glowMat.dispose();
    },
    [linkGeo, linkMat, pulseGeo, pulseMat, nodeGeo, glowMat],
  );

  // Each node owns a material (colors differ); created once.
  const nodeMats = useMemo(
    () => TOOL_NODES.map(() => new THREE.MeshBasicMaterial({ color: PALETTE.fgSubtle, transparent: true })),
    [],
  );
  const glowMats = useMemo(() => TOOL_NODES.map(() => glowMat.clone()), [glowMat]);
  const ringMats = useMemo(
    () =>
      TOOL_NODES.map(
        () =>
          new THREE.SpriteMaterial({
            map: getRingTexture(),
            color: PALETTE.fgSubtle,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
      ),
    [],
  );
  const labelMats = useMemo(
    () =>
      TOOL_NODES.map(
        (n) =>
          new THREE.SpriteMaterial({
            map: labelTexture(n.label).texture,
            color: PALETTE.fgSubtle,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            depthTest: false,
          }),
      ),
    [],
  );
  useEffect(
    () => () => {
      nodeMats.forEach((m) => m.dispose());
      glowMats.forEach((m) => m.dispose());
      ringMats.forEach((m) => m.dispose());
      labelMats.forEach((m) => m.dispose());
    },
    [nodeMats, glowMats, ringMats, labelMats],
  );

  const activeSet = useMemo(() => new Set<string>(active), [active]);

  useFrame((_, dt) => {
    const L = levels.current;
    const { a, b, c, p, q } = scratch.current;
    const gateOpen = approvalGateOpen(stage, L.progress);
    const k = damp(2.6, dt);
    const act = activation.current;
    const lines = linkLines.current;
    const pts = pulsePoints.current;
    if (!lines || !pts) return;
    const linkUniforms = (lines.material as THREE.ShaderMaterial).uniforms;
    const posAttr = lines.geometry.getAttribute("position") as THREE.BufferAttribute;
    const pulsePos = pts.geometry.getAttribute("position") as THREE.BufferAttribute;
    const pulseCol = pts.geometry.getAttribute("color") as THREE.BufferAttribute;
    const drift = L.time * 0.045;
    const vertsPerLink = seg * 2;
    const f = (L.time * 0.5) % 1;

    for (let i = 0; i < N; i++) {
      const id = TOOL_NODES[i].id;
      const on = activeSet.has(id) ? 1 : 0;
      act[i] += (on - act[i]) * k;
      const gated = stage === "act" && id === "calendar" && !gateOpen;
      const tone = gated ? palette.warning : stage === "verify" && on ? palette.verify : palette.accent;

      const theta = (i / N) * Math.PI * 2 + drift + 0.35;
      b.set(Math.cos(theta) * ORBIT_RADIUS, Math.sin(theta) * ORBIT_RADIUS, 0);
      const node = nodes.current[i];
      if (node) node.position.copy(b);

      // Node color and glow.
      const mix = Math.min(1, act[i]);
      const coreMesh = cores.current[i];
      if (coreMesh) {
        const m = coreMesh.material as THREE.MeshBasicMaterial;
        m.color.copy(palette.idle).lerp(tone, mix);
        m.opacity = (0.55 + 0.45 * mix) * L.orbit;
        coreMesh.scale.setScalar(0.55 + mix * 0.6 + (gated ? Math.sin(L.time * 6) * 0.12 : 0));
      }
      const glow = glows.current[i];
      if (glow) {
        const gm = glow.material as THREE.SpriteMaterial;
        gm.color.copy(palette.idle).lerp(tone, mix);
        gm.opacity = 0.55 * mix * L.orbit;
        glow.scale.setScalar(0.25 + mix * 0.55);
      }
      const ring = rings.current[i];
      if (ring) {
        const rm = ring.material as THREE.SpriteMaterial;
        rm.color.copy(palette.idle).lerp(tone, mix);
        rm.opacity = (0.28 + 0.5 * mix) * L.orbit;
        ring.scale.setScalar(0.2 + mix * 0.08 + (gated ? Math.sin(L.time * 4) * 0.03 : 0));
      }
      const label = labelSprites.current[i];
      if (label) {
        const lm = label.material as THREE.SpriteMaterial;
        const visible = labels === "all" ? 0.45 + 0.55 * mix : labels === "active" ? mix : 0;
        lm.opacity = Math.max(0, Math.min(1, visible * L.orbit));
        lm.color.copy(palette.idle).lerp(gated ? palette.warning : palette.label, mix);
        const h = 0.2;
        label.scale.set(h * labelTexture(TOOL_NODES[i].label).aspect, h, 1);
      }

      // Link from the core surface to the node, arcing out of the orbit plane.
      a.copy(b).normalize().multiplyScalar(0.95);
      c.copy(a).add(b).multiplyScalar(0.5);
      c.z += LIFT;
      for (let s = 0; s < seg; s++) {
        bezier(p, a, c, b, s / seg);
        bezier(q, a, c, b, (s + 1) / seg);
        const o = i * vertsPerLink + s * 2;
        posAttr.setXYZ(o, p.x, p.y, p.z);
        posAttr.setXYZ(o + 1, q.x, q.y, q.z);
      }
      (linkUniforms.uAct.value as Float32Array)[i] = gated ? mix * 0.35 : mix;
      (linkUniforms.uCol.value as THREE.Color[])[i].copy(tone);

      // Pulse heads ride the comets of active links.
      for (let h = 0; h < 2; h++) {
        const t = (h + f) / 1.6;
        const idx = i * 2 + h;
        const visible = t <= 1 && !gated ? mix : 0;
        bezier(p, a, c, b, Math.min(t, 1));
        pulsePos.setXYZ(idx, p.x, p.y, p.z);
        const intensity = visible * L.links * Math.sin(Math.min(t, 1) * Math.PI);
        pulseCol.setXYZ(idx, tone.r * intensity, tone.g * intensity, tone.b * intensity);
      }
    }
    posAttr.needsUpdate = true;
    pulsePos.needsUpdate = true;
    pulseCol.needsUpdate = true;
    linkUniforms.uTime.value = L.time;
    linkUniforms.uOpacity.value = L.links;
  });

  return (
    <group rotation={TILT}>
      <lineSegments ref={linkLines} geometry={linkGeo} material={linkMat} frustumCulled={false} />
      <points ref={pulsePoints} geometry={pulseGeo} material={pulseMat} frustumCulled={false} />
      {TOOL_NODES.map((node, i) => (
        <group
          key={node.id}
          ref={(el) => {
            nodes.current[i] = el;
          }}
        >
          <mesh
            ref={(el) => {
              cores.current[i] = el;
            }}
            geometry={nodeGeo}
            material={nodeMats[i]}
          />
          <sprite
            ref={(el) => {
              glows.current[i] = el;
            }}
            material={glowMats[i]}
          />
          <sprite
            ref={(el) => {
              rings.current[i] = el;
            }}
            material={ringMats[i]}
          />
          {labels !== "none" && (
            <sprite
              ref={(el) => {
                labelSprites.current[i] = el;
              }}
              material={labelMats[i]}
              position={[0, 0, 0.3]}
              renderOrder={10}
            />
          )}
        </group>
      ))}
    </group>
  );
}
