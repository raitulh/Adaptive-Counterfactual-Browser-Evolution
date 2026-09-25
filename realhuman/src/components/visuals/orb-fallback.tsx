import { buildNetwork, rotate, round } from "@/components/visuals/network-geometry";
import { cn } from "@/lib/utils/cn";

const NETWORK = buildNetwork(34, 2.1, 7);
const SCALE = 36;

// Pre-project once at module load: static geometry, no per-render math.
const projected = NETWORK.nodes.map((node) => {
  const [x, y, z] = rotate(node, 0.35, -0.22);
  const depth = round((z + 2.4) / 4.8); // 0 (far) → 1 (near)
  return { x: round(x * SCALE, 2), y: round(-y * SCALE, 2), depth };
});

interface OrbFallbackProps {
  verified: boolean;
  litSignals: number;
  className?: string;
}

/**
 * Static SVG rendition of the verification network. Used before WebGL loads,
 * when WebGL is unavailable or disabled, and for reduced-motion users.
 */
export function OrbFallback({ verified, litSignals, className }: OrbFallbackProps) {
  const tone = verified ? "stroke-success" : "stroke-accent";
  const fillTone = verified ? "fill-success" : "fill-accent";
  return (
    <svg
      data-testid="orb-fallback"
      viewBox="-110 -110 220 220"
      aria-hidden
      className={cn("size-full overflow-visible", className)}
    >
      <g className="origin-center animate-spin-slow [transform-box:fill-box]">
        <ellipse
          rx="92"
          ry="30"
          className={cn("fill-none transition-colors duration-700", tone)}
          strokeOpacity="0.28"
          strokeWidth="0.5"
          transform="rotate(-18)"
        />
        <ellipse
          rx="92"
          ry="44"
          className={cn("fill-none transition-colors duration-700", tone)}
          strokeOpacity="0.16"
          strokeWidth="0.5"
          transform="rotate(32)"
        />
      </g>

      <g strokeWidth="0.45">
        {NETWORK.links.map(([a, b]) => {
          const from = projected[a]!;
          const to = projected[b]!;
          return (
            <line
              key={`${a}-${b}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className={cn("transition-colors duration-700", tone)}
              strokeOpacity={round(0.08 + Math.min(from.depth, to.depth) * 0.22)}
            />
          );
        })}
        {NETWORK.signalNodes.map((index, i) => {
          const node = projected[index]!;
          return (
            <line
              key={`core-${index}`}
              x1={0}
              y1={0}
              x2={node.x}
              y2={node.y}
              className={cn("transition-[stroke-opacity,stroke] duration-700", tone)}
              strokeOpacity={i < litSignals ? 0.55 : 0.06}
              strokeWidth="0.6"
            />
          );
        })}
      </g>

      <g>
        {projected.map((node, index) => (
          <circle
            key={index}
            cx={node.x}
            cy={node.y}
            r={round(0.7 + node.depth * 1.5)}
            className={cn("transition-colors duration-700", fillTone)}
            fillOpacity={round(0.18 + node.depth * 0.62)}
          />
        ))}
        {NETWORK.signalNodes.map((index, i) => {
          const node = projected[index]!;
          const lit = i < litSignals;
          return (
            <g key={`signal-${index}`}>
              <circle
                cx={node.x}
                cy={node.y}
                r={lit ? 6 : 4}
                className={cn("fill-none transition-all duration-700", tone)}
                strokeOpacity={lit ? 0.5 : 0.15}
                strokeWidth="0.6"
              />
              <circle
                cx={node.x}
                cy={node.y}
                r="2.4"
                className={cn("transition-colors duration-700", lit ? fillTone : "fill-subtle")}
              />
            </g>
          );
        })}
      </g>

      <g>
        <circle
          r="26"
          className={cn("fill-none transition-colors duration-700", tone)}
          strokeOpacity="0.35"
          strokeWidth="0.6"
        />
        <circle
          r="18"
          className={cn("transition-colors duration-700", fillTone)}
          fillOpacity="0.12"
        />
        <circle
          r="9"
          className={cn("transition-colors duration-700", fillTone)}
          fillOpacity={verified ? 0.95 : 0.7}
        />
      </g>
    </svg>
  );
}
