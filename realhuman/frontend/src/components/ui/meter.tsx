"use client";

import { m } from "framer-motion";
import type { CSSProperties } from "react";
import { duration, ease } from "@/lib/constants/motion";
import { cn } from "@/lib/utils/cn";

interface MeterProps {
  value: number;
  className?: string;
  barClassName?: string;
  delay?: number;
  label: string;
}

/**
 * 0–1 bar that fills when scrolled into view. The track is observed (the bar
 * starts at zero width, which an IntersectionObserver would never report).
 */
export function Meter({ value, className, barClassName, delay = 0, label }: MeterProps) {
  return (
    <m.div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={value}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      className={cn("h-1.5 overflow-hidden rounded-full bg-surface-overlay", className)}
    >
      <m.div
        data-meter
        style={{ "--value": value } as CSSProperties}
        className={cn("h-full w-full origin-left rounded-full bg-accent", barClassName)}
        variants={{ hidden: { scaleX: 0 }, visible: { scaleX: value } }}
        transition={{ duration: duration.cinematic * 1.4, ease: ease.outExpo, delay }}
      />
    </m.div>
  );
}
