"use client";

import { useRef } from "react";
import type { SystemStage } from "@/components/three/stage";
import { SystemVisual } from "@/components/three/SystemVisual";
import { useInViewport } from "@/components/three/use-visual-plan";
import { cn } from "@/lib/utils";

/** A boxed Agent Core (3D when capable, 2D otherwise) that pauses whenever it is offscreen. */
export function CorePanel({ stage = "idle", className }: { stage?: SystemStage; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInViewport(ref, "60px");
  return (
    <div ref={ref} className={cn("relative aspect-square w-full", className)} aria-hidden>
      <div className="absolute inset-[8%] rounded-full bg-[radial-gradient(closest-side,rgb(92_225_230/0.10),transparent)]" />
      <SystemVisual stage={stage} framing="center" running={inView} />
    </div>
  );
}
