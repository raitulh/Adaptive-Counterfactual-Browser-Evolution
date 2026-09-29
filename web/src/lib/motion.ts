/**
 * Motion system. Durations by intent:
 *   micro interactions 100–250 ms · panels 200–350 ms · cinematic 500–1200 ms.
 * Motion communicates state, progress, focus, hierarchy and cause→effect — never decoration alone.
 * Reduced motion is honoured globally (MotionConfig reducedMotion="user" + CSS media query).
 */
import type { Transition, Variants } from "motion/react";

export const durations = { micro: 0.16, panel: 0.28, cinematic: 0.9 } as const;

export const easings = {
  outExpo: [0.16, 1, 0.3, 1] as [number, number, number, number],
  inOutQuart: [0.76, 0, 0.24, 1] as [number, number, number, number],
};

export const springs = {
  snappy: { type: "spring", stiffness: 520, damping: 38, mass: 0.7 } satisfies Transition,
  gentle: { type: "spring", stiffness: 220, damping: 30 } satisfies Transition,
} as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: durations.panel, ease: easings.outExpo } },
};

export const staggerChildren = (stagger = 0.04): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger } },
});

/** Timeline entries slide in from the rail. */
export const timelineItem: Variants = {
  hidden: { opacity: 0, x: -6 },
  show: { opacity: 1, x: 0, transition: { duration: durations.micro * 1.5, ease: easings.outExpo } },
};
