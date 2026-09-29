"use client";

/**
 * Agent Core: the execution core inside its tool orbit, with the violet verification arc — the
 * brand mark brought to life. State-driven (idle · working · needs you), pure SVG + CSS
 * transforms (cheap), paused while offscreen, static under reduced motion. Decorative: the
 * caller renders the status as text.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export type CoreState = "idle" | "working" | "attention";

const ORBIT_NODES = [0, 120, 240];

function usePausedOffscreen<T extends Element>() {
  const ref = React.useRef<T>(null);
  const [visible, setVisible] = React.useState(true);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    const onVisibility = () => setVisible(document.visibilityState === "visible" && el.getBoundingClientRect().bottom > 0);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return [ref, visible] as const;
}

const spin = (seconds: number, reverse = false): React.CSSProperties => ({
  transformBox: "view-box",
  transformOrigin: "50% 50%",
  animation: `core-spin ${seconds}s linear infinite${reverse ? " reverse" : ""}`,
});

export function CoreVisual({ state, className }: { state: CoreState; className?: string }) {
  const [ref, visible] = usePausedOffscreen<HTMLDivElement>();
  const working = state === "working";
  const attention = state === "attention";
  const gid = React.useId().replace(/:/g, "");

  return (
    <div
      ref={ref}
      aria-hidden
      data-state={state}
      className={cn(
        "relative aspect-square w-full select-none",
        "motion-reduce:[&_*]:!animate-none motion-reduce:[&_*]:![animation:none]",
        !visible && "[&_*]:![animation-play-state:paused]",
        className,
      )}
    >
      <div
        className={cn(
          "absolute inset-[12%] rounded-full blur-3xl transition-opacity duration-1000",
          attention ? "bg-warning/15" : working ? "bg-accent/20" : "bg-accent/10",
        )}
      />
      <svg viewBox="0 0 320 320" className="relative size-full overflow-visible">
        <defs>
          <radialGradient id={`${gid}-core`} cx="42%" cy="38%" r="65%">
            <stop offset="0%" stopColor="#E9FEFF" />
            <stop offset="45%" stopColor="#5CE1E6" />
            <stop offset="100%" stopColor="#0F5B61" />
          </radialGradient>
          <radialGradient id={`${gid}-halo`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgb(92 225 230 / 0.35)" />
            <stop offset="100%" stopColor="rgb(92 225 230 / 0)" />
          </radialGradient>
          <linearGradient id={`${gid}-arc`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#A99BFF" stopOpacity="0" />
            <stop offset="100%" stopColor="#A99BFF" />
          </linearGradient>
          <linearGradient id={`${gid}-exec`} x1="0" x2="1">
            <stop offset="0%" stopColor="#5CE1E6" stopOpacity="0" />
            <stop offset="100%" stopColor="#5CE1E6" />
          </linearGradient>
        </defs>

        {/* Outer orbit: tools */}
        <circle cx="160" cy="160" r="142" fill="none" stroke="rgb(255 255 255 / 0.07)" strokeWidth="1" />
        <g style={spin(working ? 38 : 70)}>
          <circle cx="160" cy="160" r="142" fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="1" strokeDasharray="2 10" />
          {ORBIT_NODES.map((deg, i) => {
            const rad = (deg * Math.PI) / 180;
            const x = 160 + 142 * Math.cos(rad);
            const y = 160 + 142 * Math.sin(rad);
            return (
              <g key={deg}>
                <circle cx={x} cy={y} r="9" fill="#0d0f13" stroke="rgb(255 255 255 / 0.18)" />
                <circle
                  cx={x}
                  cy={y}
                  r="3"
                  fill={working ? "#5CE1E6" : "rgb(255 255 255 / 0.5)"}
                  style={working ? { animation: `core-signal 1.6s ease-in-out ${i * 0.4}s infinite` } : undefined}
                />
              </g>
            );
          })}
        </g>

        {/* Middle ring: verification arc (violet) */}
        <circle cx="160" cy="160" r="102" fill="none" stroke="rgb(255 255 255 / 0.06)" strokeWidth="1" />
        <g style={spin(working ? 16 : 30, true)}>
          <path d="M160 58 A102 102 0 0 1 262 160" fill="none" stroke={`url(#${gid}-arc)`} strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="262" cy="160" r="4.5" fill="#A99BFF" />
        </g>

        {/* Attention node: someone must act */}
        {attention && (
          <g>
            <circle cx="88" cy="88" r="14" fill="rgb(245 184 74 / 0.12)" style={{ transformBox: "fill-box", transformOrigin: "center", animation: "core-pulse 2.2s cubic-bezier(0.16,1,0.3,1) infinite" }} />
            <circle cx="88" cy="88" r="6" fill="#F5B84A" />
          </g>
        )}

        {/* Inner ring: execution sweep while working */}
        <circle cx="160" cy="160" r="66" fill="none" stroke="rgb(92 225 230 / 0.28)" strokeWidth="1" />
        {working && (
          <g style={spin(3.2)}>
            <path d="M160 94 A66 66 0 0 1 226 160" fill="none" stroke={`url(#${gid}-exec)`} strokeWidth="2" strokeLinecap="round" />
          </g>
        )}

        {/* Core */}
        <circle cx="160" cy="160" r="58" fill={`url(#${gid}-halo)`} />
        <g style={{ transformBox: "fill-box", transformOrigin: "center", animation: `core-breathe ${working ? 2.4 : 4.8}s ease-in-out infinite` }}>
          <circle cx="160" cy="160" r="34" fill={`url(#${gid}-core)`} />
          <circle cx="148" cy="148" r="9" fill="rgb(255 255 255 / 0.35)" style={{ filter: "blur(4px)" }} />
        </g>
      </svg>
      <style>{`@keyframes core-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.045)}}@keyframes core-spin{to{transform:rotate(360deg)}}@keyframes core-signal{0%,100%{opacity:.35}50%{opacity:1}}@keyframes core-pulse{0%{transform:scale(.85);opacity:.9}80%,100%{transform:scale(2.2);opacity:0}}`}</style>
    </div>
  );
}
