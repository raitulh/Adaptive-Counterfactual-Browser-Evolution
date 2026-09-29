"use client";

/**
 * The system visualization with progressive enhancement:
 *   1. SSR/hydration: the 2D core (never a blank hero, no layout shift — it fills its box);
 *   2. after the browser is idle, capable devices lazy-load the WebGL scene and crossfade to it;
 *   3. the scene pauses whenever `running` is false (offscreen / hidden tab) and falls back to 2D
 *      on context loss or sustained low frame rates.
 * Decorative: the caller provides the textual equivalent; this subtree is aria-hidden.
 */
import dynamic from "next/dynamic";
import { Component, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AgentCoreFallback } from "./AgentCoreFallback";
import type { VisualQuality } from "./capabilities";
import type { ProgressRef, SystemStage, ToolNodeId } from "./stage";
import { useIdleReady, useVisualPlan } from "./use-visual-plan";

/** Any failure inside the WebGL scene degrades to the 2D visual instead of breaking the page. */
class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const AgentCoreScene = dynamic(() => import("./AgentCoreScene"), { ssr: false, loading: () => null });

export interface SystemVisualProps {
  stage: SystemStage;
  /** Live progress for the WebGL scene (read per frame). */
  progress?: ProgressRef;
  /** Quantized progress for the 2D fallback (re-renders when it changes). */
  coarseProgress?: number;
  activeNodes?: readonly ToolNodeId[];
  /** False pauses all rendering (e.g. the visual is offscreen). */
  running?: boolean;
  /** "story": full-viewport framing (core right of center / upper third); "center": fill the box. */
  framing?: "story" | "center";
  className?: string;
}

export function SystemVisual({
  stage,
  progress,
  coarseProgress = 0,
  activeNodes,
  running = true,
  framing = "story",
  className,
}: SystemVisualProps) {
  const plan = useVisualPlan();
  const idle = useIdleReady();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [quality, setQuality] = useState<VisualQuality | null>(null);
  const [hideFallback, setHideFallback] = useState(false);

  const effectiveQuality: VisualQuality = quality ?? plan?.quality ?? "low";
  const use3d = plan?.mode === "3d" && idle && !failed;
  const showScene = use3d && ready;

  // Remove the 2D layer once the crossfade has finished (saves DOM/animation work).
  useEffect(() => {
    if (!showScene) return;
    const t = setTimeout(() => setHideFallback(true), 1300);
    return () => clearTimeout(t);
  }, [showScene]);

  const onSlow = () => {
    if (effectiveQuality === "high") setQuality("low");
    else setFailed(true);
  };

  return (
    <div
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      aria-hidden
      data-visual={showScene ? "3d" : "2d"}
    >
      {!(showScene && hideFallback) && (
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-1000 ease-out",
            showScene ? "opacity-0" : "opacity-100",
          )}
        >
          <AgentCoreFallback
            stage={stage}
            progress={coarseProgress}
            activeNodes={activeNodes}
            animate={plan ? plan.animate : false}
            className={
              framing === "center"
                ? "absolute top-1/2 left-1/2 w-[88%] -translate-x-1/2 -translate-y-1/2"
                : "absolute top-[33%] left-1/2 w-[min(112vw,640px)] -translate-x-1/2 -translate-y-1/2 lg:top-1/2 lg:left-[70%] lg:w-[min(60vw,86vh)]"
            }
          />
        </div>
      )}
      {use3d && (
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-1000 ease-out",
            showScene ? "opacity-100" : "opacity-0",
          )}
        >
          <SceneBoundary onError={() => setFailed(true)}>
            <AgentCoreScene
              stage={stage}
              progress={progress}
              activeNodes={activeNodes}
              quality={effectiveQuality}
              running={running}
              framing={framing === "center" ? "center" : "auto"}
              onReady={() => setReady(true)}
              onSlow={onSlow}
              onContextLost={() => setFailed(true)}
            />
          </SceneBoundary>
        </div>
      )}
    </div>
  );
}
