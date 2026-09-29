"use client";

import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "motion/react";
import { useRef, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

export interface Verb {
  label: string;
  /** Tailwind text color class for the emphasized state (tone meaning applies). */
  tone?: string;
}

const noopSubscribe = () => () => {};

function Word({
  verb,
  index,
  count,
  progress,
}: {
  verb: Verb;
  index: number;
  count: number;
  progress: MotionValue<number>;
}) {
  const start = index / count;
  const opacity = useTransform(progress, [start, start + 1 / count], [0.28, 1]);
  return (
    <motion.span style={{ opacity }} className={verb.tone ?? "text-fg"}>
      {verb.label}
    </motion.span>
  );
}

/**
 * A sentence of verbs that light up one by one as it scrolls through the viewport — text emphasis
 * tied to scroll. Server render, no-JS and reduced motion show it fully lit.
 */
export function VerbSequence({ verbs, className }: { verbs: readonly Verb[]; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const reduced = useReducedMotion();
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.9", "end 0.45"] });
  const animated = hydrated && !reduced;

  return (
    <p ref={ref} className={cn("text-balance", className)}>
      {verbs.map((v, i) => (
        <span key={v.label}>
          {animated ? (
            <Word verb={v} index={i} count={verbs.length} progress={scrollYProgress} />
          ) : (
            <span className={v.tone ?? "text-fg"}>{v.label}</span>
          )}
          <span className="text-fg-subtle">
            {i < verbs.length - 2 ? ", " : i === verbs.length - 2 ? " — and " : "."}
          </span>
        </span>
      ))}
    </p>
  );
}
