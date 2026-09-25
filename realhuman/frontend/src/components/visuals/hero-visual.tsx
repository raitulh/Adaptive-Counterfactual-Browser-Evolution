"use client";

import { useInView } from "framer-motion";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { FINAL_PHASE, litSignalCount } from "@/components/visuals/hero-sequence";
import { OrbFallback } from "@/components/visuals/orb-fallback";
import { SequencePanel } from "@/components/visuals/sequence-panel";
import { useHeroSequence } from "@/components/visuals/use-hero-sequence";
import { useFinePointer, useMediaQuery, usePrefersReducedMotion } from "@/hooks/use-media-query";
import { useWebGLCapability } from "@/hooks/use-webgl-support";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils/cn";

// Three.js only loads on capable devices, after the page is interactive.
const VerificationOrb = dynamic(() => import("@/components/visuals/verification-orb"), {
  ssr: false,
  loading: () => null,
});

function whenIdle(callback: () => void): () => void {
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(callback, { timeout: 1500 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(callback, 600);
  return () => clearTimeout(id);
}

/**
 * Hero visual with progressive enhancement:
 *   1. SSR/no-JS/no-WebGL: static SVG network (always rendered first).
 *   2. Capable devices: WebGL scene loads on idle and cross-fades in.
 *   3. Reduced motion: final state, rendered on demand, no pointer follow.
 */
export function HeroVisual({ className }: { className?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const inView = useInView(container, { margin: "120px 0px" });
  const reducedMotion = usePrefersReducedMotion();
  const finePointer = useFinePointer();
  const compact = useMediaQuery("(max-width: 767px)");
  const capability = useWebGLCapability();

  const { phase, replay, done } = useHeroSequence(inView, reducedMotion);
  const [idle, setIdle] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const canUse3D =
    env.NEXT_PUBLIC_ENABLE_3D && !failed && (capability === "full" || capability === "low");

  useEffect(() => {
    if (!canUse3D) return;
    return whenIdle(() => setIdle(true));
  }, [canUse3D]);

  const show3D = canUse3D && idle;
  const verified = phase >= FINAL_PHASE;

  return (
    <div ref={container} className={cn("relative", className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-[-12%] [--glow:rgb(94_169_247/0.15)] glow"
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-[-12%] transition-opacity duration-1000 [--glow:rgb(62_227_154/0.17)] glow",
          verified ? "opacity-100" : "opacity-0",
        )}
      />

      <div className="relative mx-auto aspect-square w-full max-w-[34rem] lg:mr-0">
        <OrbFallback
          verified={verified}
          litSignals={litSignalCount(phase)}
          className={cn(
            "absolute inset-[6%] transition-[opacity,visibility] duration-700",
            show3D && ready ? "invisible opacity-0" : "visible opacity-100",
          )}
        />
        {show3D ? (
          <div
            data-testid="orb-canvas"
            className={cn(
              "absolute inset-0 transition-opacity duration-1000",
              ready ? "opacity-100" : "opacity-0",
            )}
          >
            <VerificationOrb
              phase={phase}
              running={inView && !reducedMotion}
              interactive={finePointer && !reducedMotion}
              density={capability === "low" || compact ? "low" : "full"}
              onReady={() => setReady(true)}
              onContextLost={() => setFailed(true)}
            />
          </div>
        ) : null}
      </div>

      <SequencePanel
        phase={phase}
        canReplay={done && !reducedMotion}
        onReplay={replay}
        className="relative mx-auto -mt-8 sm:absolute sm:-bottom-4 sm:left-0 sm:mt-0 lg:-left-4"
      />
    </div>
  );
}
