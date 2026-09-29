"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { VisualQuality } from "./capabilities";
import { damp, mulberry32, type LevelsRef } from "./levels";
import { PALETTE, type SystemStage } from "./stage";

const MEMORY_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uConverge;
uniform float uPixelRatio;
uniform float uSize;
attribute float aConfidence;
attribute float aSeed;
attribute float aVerified;
varying float vConfidence;
varying float vVerified;
varying float vTwinkle;
void main() {
  vec3 p = position;
  // Slow orbital drift; farther memories drift slower.
  float r = length(p.xz);
  float ang = uTime * (0.05 / (0.4 + r * 0.25)) + aSeed * 0.3;
  float c = cos(ang), s = sin(ang);
  p.xz = mat2(c, -s, s, c) * p.xz;
  // Learning consolidates confident memories toward the core; uncertain ones stay out.
  float pull = uConverge * smoothstep(0.35, 1.0, aConfidence);
  vec3 target = normalize(p) * (2.45 + aSeed * 0.5);
  p = mix(p, target, pull * 0.85);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vConfidence = aConfidence;
  vVerified = aVerified;
  vTwinkle = 0.65 + 0.35 * sin(uTime * (0.6 + aSeed * 1.8) + aSeed * 50.0);
  gl_PointSize = uSize * (0.55 + aConfidence * 1.1) * uPixelRatio * (10.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const MEMORY_FRAGMENT = /* glsl */ `
uniform float uOpacity;
uniform float uVerify;
uniform vec3 uLow;
uniform vec3 uHigh;
uniform vec3 uVerifyColor;
varying float vConfidence;
varying float vVerified;
varying float vTwinkle;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  vec3 col = mix(uLow, uHigh, vConfidence);
  col = mix(col, uVerifyColor, vVerified * uVerify);
  float alpha = a * uOpacity * (0.28 + 0.95 * vConfidence) * vTwinkle;
  gl_FragColor = vec4(col, alpha);
}
`;

/**
 * Memory as a field of particles: brightness and size encode confidence, dim ones are stale or
 * unverified. In the learn stage confident memories consolidate toward the core and verified facts
 * light up violet.
 */
export function MemoryField({
  levels,
  stage,
  quality,
}: {
  levels: LevelsRef;
  stage: SystemStage;
  quality: VisualQuality;
}) {
  const count = quality === "high" ? 720 : 340;
  const points = useRef<THREE.Points>(null);
  const local = useRef({ converge: 0, verify: 0 });

  const { geometry, material } = useMemo(() => {
    const rand = mulberry32(42);
    const pos = new Float32Array(count * 3);
    const conf = new Float32Array(count);
    const seed = new Float32Array(count);
    const verified = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = 3.5 + Math.pow(rand(), 0.8) * 4.2;
      const a = rand() * Math.PI * 2;
      // Thin, slightly warped disk; gaussian-ish thickness.
      const y = (rand() + rand() + rand() - 1.5) * 0.55 + Math.sin(a * 2) * 0.25;
      pos.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
      const c = Math.pow(rand(), 1.6);
      conf[i] = c;
      seed[i] = rand();
      verified[i] = c > 0.72 && rand() > 0.55 ? 1 : 0;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute("aConfidence", new THREE.BufferAttribute(conf, 1));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    geometry.setAttribute("aVerified", new THREE.BufferAttribute(verified, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: MEMORY_VERTEX,
      fragmentShader: MEMORY_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uConverge: { value: 0 },
        uVerify: { value: 0 },
        uOpacity: { value: 0 },
        uPixelRatio: { value: 1 },
        uSize: { value: quality === "high" ? 4.2 : 4.6 },
        uLow: { value: new THREE.Color(PALETTE.fgSubtle) },
        uHigh: { value: new THREE.Color(PALETTE.accent).lerp(new THREE.Color(PALETTE.fg), 0.55) },
        uVerifyColor: { value: new THREE.Color(PALETTE.verify) },
      },
    });
    return { geometry, material };
  }, [count, quality]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame((state, dt) => {
    const pts = points.current;
    if (!pts) return;
    const L = levels.current;
    const s = local.current;
    const learning = stage === "learn";
    s.converge += ((learning ? Math.min(1, 0.25 + L.progress) : 0) - s.converge) * damp(1.4, dt);
    s.verify += ((learning ? 1 : 0) - s.verify) * damp(1.2, dt);
    const u = (pts.material as THREE.ShaderMaterial).uniforms;
    u.uTime.value = L.time;
    u.uConverge.value = s.converge;
    u.uVerify.value = s.verify;
    u.uOpacity.value = L.memory;
    u.uPixelRatio.value = state.viewport.dpr;
  });

  return (
    <group rotation={[0.18, 0, -0.06]}>
      <points ref={points} geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
}
