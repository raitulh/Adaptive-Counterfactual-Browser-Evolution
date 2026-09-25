import { createSeededRandom } from "@/lib/utils/random";

export type Vec3 = readonly [number, number, number];

/**
 * Trig results can differ in the last bit between JavaScript engines. Rounding
 * keeps server-rendered SVG identical to the client render (no hydration diff).
 */
export const round = (value: number, digits = 3) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export interface VerificationNetwork {
  nodes: Vec3[];
  /** Pairs of node indexes. */
  links: [number, number][];
  /** Indexes of the four nodes that represent the four signals. */
  signalNodes: [number, number, number, number];
}

/**
 * Deterministic node layout shared by the WebGL scene and the SVG fallback:
 * a Fibonacci sphere with light jitter, each node linked to its two nearest
 * neighbours. Kept small on purpose — the network should read as a system,
 * not as noise.
 */
export function buildNetwork(count: number, radius = 2.1, seed = 7): VerificationNetwork {
  const random = createSeededRandom(seed);
  const nodes: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2;
    const ring = Math.sqrt(1 - y * y);
    const theta = golden * i;
    const r = radius * (0.9 + random() * 0.2);
    nodes.push([
      round(Math.cos(theta) * ring * r, 4),
      round(y * r * 0.92, 4),
      round(Math.sin(theta) * ring * r, 4),
    ]);
  }

  const seen = new Set<string>();
  const links: [number, number][] = [];
  nodes.forEach((node, i) => {
    const nearest = nodes
      .map((other, j) => ({ j, d: distance(node, other) }))
      .filter(({ j }) => j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const { j } of nearest) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push(i < j ? [i, j] : [j, i]);
      }
    }
  });

  // Four well-separated nodes facing the viewer act as the signal nodes.
  const facing = nodes
    .map((node, index) => ({ index, z: node[2], x: node[0] }))
    .filter(({ z }) => z > radius * 0.15);
  const pickQuadrant = (predicate: (n: { x: number; y: number }) => boolean, fallback: number) => {
    const match = facing.find(({ index }) => {
      const node = nodes[index]!;
      return predicate({ x: node[0], y: node[1] });
    });
    return match?.index ?? fallback;
  };
  const signalNodes: [number, number, number, number] = [
    pickQuadrant(({ x, y }) => x < -0.4 && y > 0.3, 0),
    pickQuadrant(({ x, y }) => x > 0.4 && y > 0.3, 1),
    pickQuadrant(({ x, y }) => x > 0.4 && y < -0.3, 2),
    pickQuadrant(({ x, y }) => x < -0.4 && y < -0.3, 3),
  ];

  return { nodes, links, signalNodes };
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Rotates a point around the Y then X axis (used for the static SVG projection). */
export function rotate(point: Vec3, yaw: number, pitch: number): Vec3 {
  const [x, y, z] = point;
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const x1 = x * cosY + z * sinY;
  const z1 = -x * sinY + z * cosY;
  const cosX = Math.cos(pitch);
  const sinX = Math.sin(pitch);
  return [round(x1, 4), round(y * cosX - z1 * sinX, 4), round(y * sinX + z1 * cosX, 4)];
}
