"use client";

import { m } from "framer-motion";
import type { ReactNode } from "react";
import { duration, ease } from "@/lib/constants/motion";

interface RevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  /** Vertical offset in px. Reduced-motion users get opacity only (MotionConfig). */
  y?: number;
}

/**
 * Brief opacity + transform entrance when the element scrolls into view.
 * `data-reveal` lets the <noscript> style in the root layout keep content
 * visible when JavaScript is unavailable.
 */
export function Reveal({ children, className, delay = 0, y = 14 }: RevealProps) {
  return (
    <m.div
      data-reveal
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: duration.cinematic, ease: ease.outExpo, delay }}
    >
      {children}
    </m.div>
  );
}
