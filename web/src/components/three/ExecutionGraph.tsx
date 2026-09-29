"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { VisualQuality } from "./capabilities";
import { labelTexture } from "./label-texture";
import { damp, getGlowTexture, mulberry32, type LevelsRef } from "./levels";
import { DOTS_FRAGMENT, DOTS_VERTEX } from "./shaders";
import { GRAPH_NODES, graphNodeStates, PALETTE, type GraphNodeState, type SystemStage } from "./stage";

const EDGE_VERTEX = /* glsl */ `
attribute float aT;
attribute float aEdge;
uniform float uDraw[5];
uniform float uAct[5];
uniform vec3 uCol[5];
varying float vT;
varying float vDraw;
varying float vAct;
varying vec3 vCol;
void main() {
  int i = int(aEdge + 0.5);
  vT = aT;
  vDraw = uDraw[i];
  vAct = uAct[i];
  vCol = uCol[i];
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const EDGE_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
varying float vT;
varying float vDraw;
varying float vAct;
varying vec3 vCol;
void main() {
  if (vT > vDraw) discard;
  float head = smoothstep(vDraw - 0.12, vDraw, vT) * step(vDraw, 0.999);
  float comet = pow(fract(vT * 1.4 - uTime * 0.7), 8.0) * vAct;
  float a = uOpacity * (0.32 + head * 0.6 + comet * 0.8);
  gl_FragColor = vec4(vCol * (0.8 + comet + head), a);
}
`;

const STREAM_VERTEX = /* glsl */ `
attribute float aT;
attribute float aOffset;
varying float vT;
varying float vOffset;
void main() {
  vT = aT;
  vOffset = aOffset;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const STREAM_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uColor;
varying float vT;
varying float vOffset;
void main() {
  float comet = pow(fract(vT * 1.5 - uTime * 0.09 + vOffset), 14.0);
  float edge = smoothstep(0.0, 0.2, vT) * smoothstep(1.0, 0.8, vT);
  gl_FragColor = vec4(uColor, (0.025 + comet * 0.55) * edge * uOpacity);
}
`;

/** Plan DAG: two parallel reads → the calendar write → the confirmation e-mail. Root = the core. */
const NODE_POS: Array<[number, number, number]> = [
  [-1.55, 2.0, 0.95],
  [-1.0, 2.8, 0.55],
  [0.35, 2.55, 0.95],
  [1.75, 2.05, 0.8],
];
const ROOT: [number, number, number] = [0, 0.95, 0.35];
/** [from, to]; -1 is the root. */
const EDGES: Array<[number, number]> = [
  [-1, 0],
  [-1, 1],
  [0, 2],
  [1, 2],
  [2, 3],
];

const STATE_COLOR: Record<GraphNodeState, string> = {
  hidden: PALETTE.fgSubtle,
  pending: PALETTE.fgMuted,
  running: PALETTE.accent,
  waiting_approval: PALETTE.warning,
  verifying: PALETTE.verify,
  completed: PALETTE.success,
};

function edgeCurve(from: THREE.Vector3, to: THREE.Vector3, segments: number): Float32Array {
  const ctrl = from.clone().add(to).multiplyScalar(0.5);
  ctrl.y += 0.35;
  ctrl.z += 0.2;
  const curve = new THREE.QuadraticBezierCurve3(from, ctrl, to);
  const pts = curve.getPoints(segments);
  const out = new Float32Array(segments * 6);
  for (let s = 0; s < segments; s++) {
    out.set([pts[s].x, pts[s].y, pts[s].z, pts[s + 1].x, pts[s + 1].y, pts[s + 1].z], s * 6);
  }
  return out;
}

export interface ExecutionGraphProps {
  levels: LevelsRef;
  stage: SystemStage;
  quality: VisualQuality;
  labels: boolean;
}

/** The execution lattice: task streams in the background and the plan graph materializing above the core. */
export function ExecutionGraph({ levels, stage, quality, labels }: ExecutionGraphProps) {
  const seg = quality === "high" ? 24 : 14;
  const edges = useRef<THREE.LineSegments>(null);
  const nodeMeshes = useRef<Array<THREE.Mesh | null>>([]);
  const nodeGlows = useRef<Array<THREE.Sprite | null>>([]);
  const labelSprites = useRef<Array<THREE.Sprite | null>>([]);
  const lattice = useRef<THREE.Points>(null);
  const streams = useRef<THREE.LineSegments>(null);
  const damped = useRef({ scale: new Float32Array(4), draw: new Float32Array(5) });
  const colors = useMemo(
    () =>
      Object.fromEntries(Object.entries(STATE_COLOR).map(([k, v]) => [k, new THREE.Color(v)])) as Record<
        GraphNodeState,
        THREE.Color
      >,
    [],
  );

  const built = useMemo(() => {
    // Plan edges
    const edgeGeo = new THREE.BufferGeometry();
    const edgePos = new Float32Array(EDGES.length * seg * 6);
    const aT = new Float32Array(EDGES.length * seg * 2);
    const aEdge = new Float32Array(EDGES.length * seg * 2);
    const vec = (p: [number, number, number]) => new THREE.Vector3(...p);
    EDGES.forEach(([from, to], e) => {
      edgePos.set(edgeCurve(vec(from < 0 ? ROOT : NODE_POS[from]), vec(NODE_POS[to]), seg), e * seg * 6);
      for (let s = 0; s < seg; s++) {
        const o = e * seg * 2 + s * 2;
        aT[o] = s / seg;
        aT[o + 1] = (s + 1) / seg;
        aEdge[o] = aEdge[o + 1] = e;
      }
    });
    edgeGeo.setAttribute("position", new THREE.BufferAttribute(edgePos, 3));
    edgeGeo.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
    edgeGeo.setAttribute("aEdge", new THREE.BufferAttribute(aEdge, 1));
    const edgeMat = new THREE.ShaderMaterial({
      vertexShader: EDGE_VERTEX,
      fragmentShader: EDGE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uDraw: { value: new Float32Array(5) },
        uAct: { value: new Float32Array(5) },
        uCol: { value: Array.from({ length: 5 }, () => new THREE.Color(PALETTE.fgMuted)) },
      },
    });
    const nodeGeo = new THREE.OctahedronGeometry(0.1, 0);
    const nodeMats = NODE_POS.map(
      () => new THREE.MeshBasicMaterial({ color: PALETTE.fgMuted, transparent: true, opacity: 0 }),
    );
    const glowMats = NODE_POS.map(
      () =>
        new THREE.SpriteMaterial({
          map: getGlowTexture(),
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          opacity: 0,
        }),
    );

    // Background lattice of task slots
    const rand = mulberry32(7);
    const gx = quality === "high" ? 22 : 14;
    const gy = quality === "high" ? 12 : 9;
    const spacing = 1.25;
    const latPos = new Float32Array(gx * gy * 3);
    const latSeed = new Float32Array(gx * gy);
    for (let x = 0; x < gx; x++) {
      for (let y = 0; y < gy; y++) {
        const i = x * gy + y;
        latPos.set([(x - (gx - 1) / 2) * spacing, (y - (gy - 1) / 2) * spacing, -6], i * 3);
        latSeed[i] = rand();
      }
    }
    const latGeo = new THREE.BufferGeometry();
    latGeo.setAttribute("position", new THREE.BufferAttribute(latPos, 3));
    latGeo.setAttribute("aSeed", new THREE.BufferAttribute(latSeed, 1));
    const latMat = new THREE.ShaderMaterial({
      vertexShader: DOTS_VERTEX,
      fragmentShader: DOTS_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 2.6 },
        uPixelRatio: { value: 1 },
        uColor: { value: new THREE.Color(PALETTE.fgSubtle) },
        uOpacity: { value: 0 },
      },
    });

    // Task streams: vertical lanes where work flows upward
    const lanes = quality === "high" ? 9 : 5;
    const laneSeg = 36;
    const sPos = new Float32Array(lanes * laneSeg * 6);
    const sT = new Float32Array(lanes * laneSeg * 2);
    const sOff = new Float32Array(lanes * laneSeg * 2);
    for (let l = 0; l < lanes; l++) {
      const x = (Math.floor(rand() * gx) - (gx - 1) / 2) * spacing;
      const off = rand();
      const h = (gy - 1) * spacing;
      for (let s = 0; s < laneSeg; s++) {
        const y0 = -h / 2 + (s / laneSeg) * h;
        const y1 = -h / 2 + ((s + 1) / laneSeg) * h;
        const o = (l * laneSeg + s) * 6;
        sPos.set([x, y0, -6, x, y1, -6], o);
        const v = (l * laneSeg + s) * 2;
        sT[v] = s / laneSeg;
        sT[v + 1] = (s + 1) / laneSeg;
        sOff[v] = sOff[v + 1] = off;
      }
    }
    const streamGeo = new THREE.BufferGeometry();
    streamGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
    streamGeo.setAttribute("aT", new THREE.BufferAttribute(sT, 1));
    streamGeo.setAttribute("aOffset", new THREE.BufferAttribute(sOff, 1));
    const streamMat = new THREE.ShaderMaterial({
      vertexShader: STREAM_VERTEX,
      fragmentShader: STREAM_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(PALETTE.accent) } },
    });

    const labelMats = GRAPH_NODES.map(
      (n) =>
        new THREE.SpriteMaterial({
          map: labelTexture(n.label, { uppercase: false, tracking: 0.02 }).texture,
          color: PALETTE.fgMuted,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: false,
        }),
    );

    return { edgeGeo, edgeMat, nodeGeo, nodeMats, glowMats, labelMats, latGeo, latMat, streamGeo, streamMat };
  }, [seg, quality]);

  useEffect(
    () => () => {
      const b = built;
      [b.edgeGeo, b.nodeGeo, b.latGeo, b.streamGeo].forEach((g) => g.dispose());
      [b.edgeMat, b.latMat, b.streamMat, ...b.nodeMats, ...b.glowMats, ...b.labelMats].forEach((m) => m.dispose());
    },
    [built],
  );

  useFrame((state, dt) => {
    const L = levels.current;
    const states = graphNodeStates(stage, L.progress);
    const d = damped.current;
    const k = damp(3.2, dt);

    for (let i = 0; i < NODE_POS.length; i++) {
      const st = states[i];
      d.scale[i] += ((st === "hidden" ? 0 : 1) - d.scale[i]) * k;
      const mesh = nodeMeshes.current[i];
      const visible = d.scale[i] * L.graph;
      if (mesh) {
        const m = mesh.material as THREE.MeshBasicMaterial;
        m.color.lerp(colors[st], damp(4, dt));
        m.opacity = visible;
        const wobble = st === "waiting_approval" ? 1 + Math.sin(L.time * 6) * 0.14 : 1;
        mesh.scale.setScalar(Math.max(0.001, d.scale[i] * wobble));
        mesh.rotation.y = L.time * 0.6 + i;
      }
      const glow = nodeGlows.current[i];
      if (glow) {
        const gm = glow.material as THREE.SpriteMaterial;
        gm.color.copy(meshColor(mesh));
        gm.opacity = visible * (st === "pending" ? 0.25 : 0.75);
        glow.scale.setScalar(0.55 + (st === "running" || st === "waiting_approval" ? 0.35 : 0));
      }
      const label = labelSprites.current[i];
      if (label) {
        const lm = label.material as THREE.SpriteMaterial;
        lm.opacity += (Math.min(1, visible * (L.graph > 0.5 ? 0.9 : 0)) - lm.opacity) * damp(4, dt);
        lm.color.lerp(st === "pending" || st === "hidden" ? colors.pending : colors[st], damp(4, dt));
        const h = 0.17;
        label.scale.set(h * labelTexture(GRAPH_NODES[i].label, { uppercase: false, tracking: 0.02 }).aspect, h, 1);
      }
    }

    const line = edges.current;
    if (line) {
      const u = (line.material as THREE.ShaderMaterial).uniforms;
      EDGES.forEach(([, to], e) => {
        const st = states[to];
        const target = st === "hidden" ? 0 : 1;
        d.draw[e] += (target - d.draw[e]) * damp(1.8, dt);
        (u.uDraw.value as Float32Array)[e] = d.draw[e];
        (u.uAct.value as Float32Array)[e] = st === "running" || st === "verifying" ? 1 : 0.15;
        (u.uCol.value as THREE.Color[])[e].lerp(colors[st === "hidden" ? "pending" : st], damp(4, dt));
      });
      u.uTime.value = L.time;
      u.uOpacity.value = L.graph;
    }
    if (lattice.current) {
      const u = (lattice.current.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = L.time;
      u.uOpacity.value = 0.55 * L.lattice;
      u.uPixelRatio.value = state.viewport.dpr;
    }
    if (streams.current) {
      const u = (streams.current.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = L.time;
      u.uOpacity.value = L.lattice;
    }
  });

  return (
    <group>
      <points ref={lattice} geometry={built.latGeo} material={built.latMat} frustumCulled={false} />
      <lineSegments ref={streams} geometry={built.streamGeo} material={built.streamMat} frustumCulled={false} />
      <lineSegments ref={edges} geometry={built.edgeGeo} material={built.edgeMat} frustumCulled={false} />
      {NODE_POS.map((pos, i) => (
        <group key={GRAPH_NODES[i].key} position={pos}>
          <mesh
            ref={(el) => {
              nodeMeshes.current[i] = el;
            }}
            geometry={built.nodeGeo}
            material={built.nodeMats[i]}
            scale={0.001}
          />
          <sprite
            ref={(el) => {
              nodeGlows.current[i] = el;
            }}
            material={built.glowMats[i]}
          />
          {labels && (
            <sprite
              ref={(el) => {
                labelSprites.current[i] = el;
              }}
              material={built.labelMats[i]}
              position={[0, 0.24, 0]}
              renderOrder={10}
            />
          )}
        </group>
      ))}
    </group>
  );
}

function meshColor(mesh: THREE.Mesh | null | undefined): THREE.Color {
  return mesh ? (mesh.material as THREE.MeshBasicMaterial).color : new THREE.Color(PALETTE.fgMuted);
}
