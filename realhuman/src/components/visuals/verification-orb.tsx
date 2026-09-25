"use client";

import { PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { FINAL_PHASE, litSignalCount } from "@/components/visuals/hero-sequence";
import { buildNetwork } from "@/components/visuals/network-geometry";

const ACCENT = new THREE.Color("#5ea9f7");
const SUCCESS = new THREE.Color("#3ee39a");
const IDLE = new THREE.Color("#7f8693");
const BACKGROUND = "#060709";

export interface VerificationOrbProps {
  phase: number;
  /** Continuous rendering. False → render on demand only (reduced motion, off-screen). */
  running: boolean;
  /** Pointer-follow on devices with a fine pointer. */
  interactive: boolean;
  density: "full" | "low";
  onReady: () => void;
  onContextLost: () => void;
  className?: string;
}

/**
 * Lightweight WebGL verification network: one core, a few dozen nodes, thin
 * links, four signal nodes that light up with the hero sequence. No shadows,
 * no post-processing, no textures beyond a 64px generated dot sprite.
 */
export default function VerificationOrb({
  phase,
  running,
  interactive,
  density,
  onReady,
  onContextLost,
  className,
}: VerificationOrbProps) {
  const maxDpr = density === "full" ? 1.75 : 1.25;
  const [dpr, setDpr] = useState(() =>
    Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio, maxDpr),
  );

  return (
    <Canvas
      aria-hidden
      className={className}
      dpr={dpr}
      frameloop={running ? "always" : "demand"}
      camera={{ position: [0, 0, 6.4], fov: 40, near: 0.1, far: 30 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.domElement.addEventListener(
          "webglcontextlost",
          (event) => {
            event.preventDefault();
            onContextLost();
          },
          { once: true },
        );
      }}
    >
      <PerformanceMonitor
        flipflops={3}
        onDecline={() => setDpr(1)}
        onIncline={() => setDpr(Math.min(window.devicePixelRatio, maxDpr))}
        onFallback={() => setDpr(1)}
      />
      <fog attach="fog" args={[BACKGROUND, 5.2, 8.6]} />
      <Network phase={phase} running={running} interactive={interactive} density={density} />
      <FirstFrame onReady={onReady} />
    </Canvas>
  );
}

function FirstFrame({ onReady }: { onReady: () => void }) {
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    if (frames.current === 2) onReady();
  });
  return null;
}

function createDotTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.9)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const ARC_SEGMENTS = 128;

/** Circle drawn as line segments so it can be revealed progressively with setDrawRange. */
function buildArcPositions(radius: number): Float32Array {
  const positions = new Float32Array(ARC_SEGMENTS * 6);
  for (let i = 0; i < ARC_SEGMENTS; i += 1) {
    const a0 = Math.PI / 2 - (i / ARC_SEGMENTS) * Math.PI * 2;
    const a1 = Math.PI / 2 - ((i + 1) / ARC_SEGMENTS) * Math.PI * 2;
    positions.set(
      [
        Math.cos(a0) * radius,
        Math.sin(a0) * radius,
        0,
        Math.cos(a1) * radius,
        Math.sin(a1) * radius,
        0,
      ],
      i * 6,
    );
  }
  return positions;
}

type Tintable = { color: THREE.Color; opacity: number };

function Network({
  phase,
  running,
  interactive,
  density,
}: Pick<VerificationOrbProps, "phase" | "running" | "interactive" | "density">) {
  const network = useMemo(() => buildNetwork(density === "full" ? 46 : 26, 1.72, 7), [density]);
  const invalidate = useThree((state) => state.invalidate);

  // Scene objects and materials are reached through refs and mutated in
  // useFrame — no React re-render per frame.
  const group = useRef<THREE.Group>(null);
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const arcLine = useRef<THREE.LineSegments>(null);
  const coreLinksMaterial = useRef<THREE.LineBasicMaterial>(null);
  const tinted = useRef<(Tintable | null)[]>([]);
  const signalMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const signalMaterials = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const packetMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const pointerTarget = useRef({ x: 0, y: 0 });
  const idleAngle = useRef(0);
  const progress = useRef(0);
  const color = useRef(new THREE.Color("#5ea9f7"));

  const dotTexture = useMemo(() => createDotTexture(), []);
  useEffect(() => () => dotTexture.dispose(), [dotTexture]);

  const nodePositions = useMemo(() => new Float32Array(network.nodes.flat()), [network]);
  const linkPositions = useMemo(
    () =>
      new Float32Array(
        network.links.flatMap(([a, b]) => [...network.nodes[a]!, ...network.nodes[b]!]),
      ),
    [network],
  );
  const coreLinkPositions = useMemo(
    () =>
      new Float32Array(network.signalNodes.flatMap((index) => [0, 0, 0, ...network.nodes[index]!])),
    [network],
  );
  const arcPositions = useMemo(() => buildArcPositions(0.74), []);

  useEffect(() => {
    if (!interactive || !running) return;
    const onMove = (event: PointerEvent) => {
      pointerTarget.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointerTarget.current.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [interactive, running]);

  // In demand mode, render once whenever the phase changes.
  useEffect(() => {
    if (!running) invalidate();
  }, [phase, running, invalidate]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const ease = (rate: number) => (running ? 1 - Math.exp(-dt * rate) : 1);
    const verified = phase >= FINAL_PHASE;
    const lit = litSignalCount(phase);

    const c = color.current.lerp(verified ? SUCCESS : ACCENT, ease(3));
    for (const material of tinted.current) material?.color.copy(c);

    const coreLinks = coreLinksMaterial.current;
    if (coreLinks) {
      coreLinks.color.copy(c);
      coreLinks.opacity += ((lit > 0 ? 0.42 : 0.08) - coreLinks.opacity) * ease(4);
    }

    progress.current += (phase / FINAL_PHASE - progress.current) * ease(3);
    arcLine.current?.geometry.setDrawRange(0, Math.round(progress.current * ARC_SEGMENTS) * 2);

    const time = state.clock.elapsedTime;
    for (let i = 0; i < 4; i += 1) {
      const on = i < lit;
      const material = signalMaterials.current[i];
      if (material) {
        material.color.copy(on ? c : IDLE);
        material.opacity += ((on ? 1 : 0.35) - material.opacity) * ease(5);
      }
      const mesh = signalMeshes.current[i];
      if (mesh)
        mesh.scale.setScalar(on && running && !verified ? 1 + Math.sin(time * 3 + i) * 0.18 : 1);
      const packet = packetMeshes.current[i];
      if (packet) {
        packet.visible = on && running && !verified;
        if (packet.visible) {
          const node = network.nodes[network.signalNodes[i] ?? 0]!;
          const t = 1 - ((time * 0.55 + i * 0.27) % 1);
          packet.position.set(node[0] * t, node[1] * t, node[2] * t);
        }
      }
    }

    if (running) idleAngle.current += dt * 0.06;
    if (group.current) {
      const targetY = idleAngle.current + (interactive ? pointerTarget.current.x * 0.3 : 0);
      const targetX = -0.14 + (interactive ? pointerTarget.current.y * 0.16 : 0);
      group.current.rotation.y += (targetY - group.current.rotation.y) * ease(2.2);
      group.current.rotation.x += (targetX - group.current.rotation.x) * ease(2.2);
    }
    if (ringA.current && running) ringA.current.rotation.z += dt * 0.05;
    if (ringB.current && running) ringB.current.rotation.z -= dt * 0.035;
  });

  return (
    <group ref={group}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[nodePositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={(material) => {
            tinted.current[0] = material;
          }}
          size={0.075}
          map={dotTexture}
          transparent
          depthWrite={false}
          opacity={0.85}
          sizeAttenuation
        />
      </points>

      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[linkPositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          ref={(material) => {
            tinted.current[1] = material;
          }}
          transparent
          opacity={0.16}
          depthWrite={false}
        />
      </lineSegments>

      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[coreLinkPositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial ref={coreLinksMaterial} transparent opacity={0.1} depthWrite={false} />
      </lineSegments>

      {network.signalNodes.map((index, i) => {
        const node = network.nodes[index]!;
        return (
          <mesh
            key={`signal-${index}`}
            ref={(mesh) => {
              signalMeshes.current[i] = mesh;
            }}
            position={[node[0], node[1], node[2]]}
          >
            <sphereGeometry args={[0.065, 12, 12]} />
            <meshBasicMaterial
              ref={(material) => {
                signalMaterials.current[i] = material;
              }}
              transparent
              opacity={0.4}
            />
          </mesh>
        );
      })}

      {network.signalNodes.map((index, i) => (
        <mesh
          key={`packet-${index}`}
          ref={(mesh) => {
            packetMeshes.current[i] = mesh;
          }}
          visible={false}
        >
          <sphereGeometry args={[0.028, 8, 8]} />
          <meshBasicMaterial
            ref={(material) => {
              tinted.current[2 + i] = material;
            }}
            transparent
            opacity={0.95}
          />
        </mesh>
      ))}

      <mesh>
        <icosahedronGeometry args={[0.26, 2]} />
        <meshBasicMaterial
          ref={(material) => {
            tinted.current[6] = material;
          }}
          transparent
          opacity={0.8}
        />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[0.5, 1]} />
        <meshBasicMaterial
          ref={(material) => {
            tinted.current[7] = material;
          }}
          transparent
          opacity={0.22}
          wireframe
        />
      </mesh>

      <lineSegments ref={arcLine}>
        <bufferGeometry drawRange={{ start: 0, count: 0 }}>
          <bufferAttribute attach="attributes-position" args={[arcPositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          ref={(material) => {
            tinted.current[8] = material;
          }}
          transparent
          opacity={0.9}
        />
      </lineSegments>

      <mesh ref={ringA} rotation={[1.2, 0.3, 0]}>
        <torusGeometry args={[2.08, 0.004, 6, 180]} />
        <meshBasicMaterial
          ref={(material) => {
            tinted.current[9] = material;
          }}
          transparent
          opacity={0.35}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={ringB} rotation={[1.9, -0.5, 0.4]}>
        <torusGeometry args={[1.9, 0.003, 6, 160]} />
        <meshBasicMaterial
          ref={(material) => {
            tinted.current[10] = material;
          }}
          transparent
          opacity={0.35}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
