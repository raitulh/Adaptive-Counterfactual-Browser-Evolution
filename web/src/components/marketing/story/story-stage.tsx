"use client";

/**
 * Scroll-driven narrative. Wraps server-rendered chapters; any descendant with `data-stage="…"`
 * is a stage marker. The marker crossing 55% of the viewport becomes active: it drives the pinned
 * system visual (stage + progress within the marker), gets `data-active="true"` for text emphasis,
 * and is published through context for small client widgets (the lifecycle rail).
 *
 * One passive scroll listener, work batched per animation frame, React state changes only when the
 * stage (or the quantized progress used by the 2D fallback) changes. The visual pauses when the
 * story is offscreen.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { SystemVisual } from "@/components/three/SystemVisual";
import type { SystemStage } from "@/components/three/stage";
import { useInViewport } from "@/components/three/use-visual-plan";
import { cn } from "@/lib/utils";

interface StoryState {
  stage: SystemStage;
  /** Progress within the active marker, quantized to quarters. */
  step: number;
}

const StoryContext = createContext<StoryState>({ stage: "idle", step: 0 });

export function useStory(): StoryState {
  return useContext(StoryContext);
}

const STAGES: ReadonlySet<string> = new Set(["dormant", "idle", "goal", "plan", "act", "verify", "learn"]);
const ACTIVATION_LINE = 0.55;

export function StoryStage({
  children,
  description,
  className,
}: {
  children: ReactNode;
  description: string;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const [state, setState] = useState<StoryState>({ stage: "idle", step: 0 });
  const inView = useInViewport(root, "80px");

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const markers = Array.from(el.querySelectorAll<HTMLElement>("[data-stage]")).filter((m) =>
      STAGES.has(m.dataset.stage ?? ""),
    );
    let frame = 0;
    let active: HTMLElement | null = null;

    const update = () => {
      frame = 0;
      const line = window.innerHeight * ACTIVATION_LINE;
      let next: HTMLElement | null = null;
      for (const m of markers) {
        if (m.getBoundingClientRect().top <= line) next = m;
        else break;
      }
      let p = 0;
      if (next) {
        const r = next.getBoundingClientRect();
        p = Math.min(1, Math.max(0, (line - r.top) / Math.max(1, r.height)));
      }
      progress.current = p;
      if (next !== active) {
        active?.removeAttribute("data-active");
        next?.setAttribute("data-active", "true");
        active = next;
      }
      const stage = (next?.dataset.stage as SystemStage | undefined) ?? "idle";
      const step = Math.min(1, Math.floor(p * 4 + 0.5) / 4);
      setState((prev) => (prev.stage === stage && prev.step === step ? prev : { stage, step }));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    el.dataset.ready = "true";
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      active?.removeAttribute("data-active");
      delete el.dataset.ready;
    };
  }, []);

  return (
    <StoryContext.Provider value={state}>
      <div ref={root} className={cn("group/story relative", className)}>
        {/* Pinned visual: a full-height track holding a viewport-tall sticky layer, so the visual stays
            pinned while the chapters scroll over it and leaves with the end of the story. */}
        <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
          <div className="sticky top-0 h-lvh w-full overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(60%_55%_at_70%_45%,rgb(92_225_230/0.07),transparent_70%)] max-lg:bg-[radial-gradient(90%_45%_at_50%_30%,rgb(92_225_230/0.08),transparent_70%)]" />
            <SystemVisual stage={state.stage} progress={progress} coarseProgress={state.step} running={inView} />
            {/* Legibility scrims: left column on desktop, lower half on small screens. */}
            <div className="absolute inset-y-0 left-0 hidden w-[52%] bg-gradient-to-r from-bg via-bg/70 to-transparent lg:block" />
            <div className="absolute inset-x-0 bottom-0 h-[62%] bg-gradient-to-t from-bg via-bg/85 to-transparent lg:hidden" />
            <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-bg to-transparent max-lg:hidden" />
          </div>
        </div>
        <p className="sr-only">{description}</p>
        <div className="relative z-10">{children}</div>
      </div>
    </StoryContext.Provider>
  );
}
