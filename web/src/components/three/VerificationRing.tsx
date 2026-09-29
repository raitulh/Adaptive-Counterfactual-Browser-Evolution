"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { damp, type LevelsRef } from "./levels";
import { PALETTE, verificationArc, type SystemStage } from "./stage";

const RING_VERTEX = /* glsl */ `
varying vec2 vPos;
void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RING_FRAGMENT = /* glsl */ `
uniform float uArc;
uniform float uOpacity;
uniform vec3 uColor;
uniform vec3 uBase;
varying vec2 vPos;
void main() {
  // 0 at twelve o'clock, increasing clockwise.
  float t = fract(atan(vPos.x, vPos.y) / 6.28318530718 + 1.0);
  float on = step(t, uArc);
  float head = smoothstep(uArc - 0.08, uArc, t) * on;
  vec3 col = mix(uBase * 0.35, uColor * (0.8 + head * 1.6), on);
  float a = (0.16 + on * 0.84) * uOpacity;
  gl_FragColor = vec4(col, a);
}
`;

export const RING_RADIUS = 2.3;

/**
 * The verification ring: a violet arc sweeps as read-backs confirm each effect, turns emerald when
 * the run is verified complete; a short orange arc marks reconciliation.
 */
export function VerificationRing({ levels, stage }: { levels: LevelsRef; stage: SystemStage }) {
  const group = useRef<THREE.Group>(null);
  const pulse = useRef<THREE.Mesh>(null);
  const state = useRef({ arc: 0, complete: 0, recover: 0, pulseT: 0 });

  const { ringGeo, ringMat, ticks, tickMat, recoverGeo, recoverMat, pulseGeo, pulseMat } = useMemo(() => {
    const ringGeo = new THREE.RingGeometry(RING_RADIUS - 0.022, RING_RADIUS + 0.022, 256, 1);
    const ringMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERTEX,
      fragmentShader: RING_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uArc: { value: 0 },
        uOpacity: { value: 0 },
        uColor: { value: new THREE.Color(PALETTE.verify) },
        uBase: { value: new THREE.Color(PALETTE.fgSubtle) },
      },
    });
    const n = 96;
    const tickPos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r0 = RING_RADIUS + 0.09;
      const r1 = RING_RADIUS + (i % 8 === 0 ? 0.24 : 0.15);
      tickPos.set([Math.sin(a) * r0, Math.cos(a) * r0, 0, Math.sin(a) * r1, Math.cos(a) * r1, 0], i * 6);
    }
    const ticks = new THREE.BufferGeometry();
    ticks.setAttribute("position", new THREE.BufferAttribute(tickPos, 3));
    const tickMat = new THREE.LineBasicMaterial({
      color: PALETTE.fg,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    // Reconciliation arc sits just outside the ring at ~4 o'clock.
    const recoverGeo = new THREE.RingGeometry(RING_RADIUS + 0.3, RING_RADIUS + 0.34, 64, 1, -0.35, 0.7);
    const recoverMat = new THREE.MeshBasicMaterial({
      color: PALETTE.recover,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const pulseGeo = new THREE.RingGeometry(RING_RADIUS - 0.01, RING_RADIUS + 0.01, 192, 1);
    const pulseMat = new THREE.MeshBasicMaterial({
      color: PALETTE.success,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { ringGeo, ringMat, ticks, tickMat, recoverGeo, recoverMat, pulseGeo, pulseMat };
  }, []);

  useEffect(
    () => () => {
      [ringGeo, ticks, recoverGeo, pulseGeo].forEach((g) => g.dispose());
      [ringMat, tickMat, recoverMat, pulseMat].forEach((m) => m.dispose());
    },
    [ringGeo, ringMat, ticks, tickMat, recoverGeo, recoverMat, pulseGeo, pulseMat],
  );

  const verifyColor = useMemo(() => new THREE.Color(PALETTE.verify), []);
  const successColor = useMemo(() => new THREE.Color(PALETTE.success), []);

  useFrame((_, dt) => {
    const L = levels.current;
    const s = state.current;
    const target = verificationArc(stage, L.progress);
    const k = damp(3, dt);
    s.arc += (target.arc - s.arc) * k;
    s.complete += ((target.complete ? 1 : 0) - s.complete) * damp(2.5, dt);
    s.recover += (target.recover - s.recover) * damp(5, dt);

    const u = ringMat.uniforms;
    u.uArc.value = s.arc;
    u.uOpacity.value = L.ring;
    (u.uColor.value as THREE.Color).copy(verifyColor).lerp(successColor, s.complete);
    tickMat.opacity = 0.22 * L.ring;
    recoverMat.opacity = 0.85 * s.recover * L.ring;

    // A calm "verified" pulse once the ring completes.
    if (pulse.current) {
      s.pulseT = (s.pulseT + dt / 2.6) % 1;
      const scale = 1 + s.pulseT * 0.22;
      pulse.current.scale.setScalar(scale);
      pulseMat.opacity = s.complete * (1 - s.pulseT) * 0.5 * L.ring;
    }
    if (group.current) group.current.rotation.z = Math.sin(L.time * 0.05) * 0.02;
  });

  return (
    <group ref={group}>
      <mesh geometry={ringGeo} material={ringMat} renderOrder={2} />
      <lineSegments geometry={ticks} material={tickMat} />
      <mesh geometry={recoverGeo} material={recoverMat} />
      <mesh ref={pulse} geometry={pulseGeo} material={pulseMat} />
    </group>
  );
}
