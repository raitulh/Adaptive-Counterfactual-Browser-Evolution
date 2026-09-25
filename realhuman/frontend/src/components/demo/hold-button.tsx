"use client";

import { Fingerprint } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { InputMethod } from "@/lib/schemas/verification";
import { cn } from "@/lib/utils/cn";
import type { TelemetryRecorder } from "@/lib/verification/telemetry";

export const HOLD_DURATION_MS = 1100;

interface HoldButtonProps {
  onComplete: (result: { holdDurationMs: number; inputMethod: InputMethod }) => void;
  disabled?: boolean;
  describedBy?: string;
  /** Receives press, hold and key-repeat events for the live verification engine. */
  telemetry?: TelemetryRecorder;
}

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Press-and-hold challenge. Works with mouse, touch and keyboard (hold Space
 * or Enter). Releasing early resets progress. An alternative single-step
 * challenge is offered next to it for people who can't hold.
 */
export function HoldButton({ onComplete, disabled, describedBy, telemetry }: HoldButtonProps) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const frame = useRef(0);
  const method = useRef<InputMethod>("pointer");
  const completed = useRef(false);

  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    setHolding(false);
    if (!completed.current) {
      setProgress(0);
      telemetry?.pressEnd(false);
    }
  }, [telemetry]);

  const begin = useCallback(
    (inputMethod: InputMethod) => {
      if (disabled || completed.current) return;
      method.current = inputMethod;
      const startedAt = performance.now();
      setHolding(true);

      function step() {
        const elapsed = performance.now() - startedAt;
        const value = Math.min(1, elapsed / HOLD_DURATION_MS);
        setProgress(value);
        if (value >= 1) {
          completed.current = true;
          setHolding(false);
          telemetry?.pressEnd(true);
          onComplete({ holdDurationMs: Math.round(elapsed), inputMethod: method.current });
          return;
        }
        frame.current = requestAnimationFrame(step);
      }
      frame.current = requestAnimationFrame(step);
    },
    [disabled, onComplete, telemetry],
  );

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (disabled || completed.current) return;
    telemetry?.pressStart({
      pointerType: toPointerType(event.pointerType),
      x: event.clientX,
      y: event.clientY,
      trusted: event.nativeEvent.isTrusted,
    });
    begin(event.pointerType === "touch" ? "touch" : "pointer");
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (event.repeat) {
      if (holding) telemetry?.keyRepeat();
      return;
    }
    if (holding || disabled || completed.current) return;
    telemetry?.pressStart({ pointerType: null, trusted: event.nativeEvent.isTrusted });
    begin("keyboard");
  }

  function onKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === " " || event.key === "Enter") stop();
  }

  const percent = Math.round(progress * 100);

  return (
    <button
      type="button"
      disabled={disabled}
      aria-describedby={describedBy}
      aria-label={holding ? `Holding, ${percent} percent` : "Press and hold to verify"}
      onPointerDown={onPointerDown}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={stop}
      onContextMenu={(event) => event.preventDefault()}
      className={cn(
        "group relative inline-flex size-16 shrink-0 touch-none items-center justify-center rounded-full border border-border-strong bg-surface-raised text-foreground select-none",
        "transition-[transform,border-color,background-color] duration-200 ease-out-expo hover:border-border-bright",
        holding && "scale-[0.96] border-accent/50 bg-surface-overlay",
        "disabled:opacity-50",
      )}
    >
      <svg viewBox="0 0 64 64" aria-hidden className="absolute inset-0 size-full -rotate-90">
        <circle
          cx="32"
          cy="32"
          r={RADIUS}
          className="fill-none stroke-border-strong"
          strokeWidth="2"
        />
        <circle
          cx="32"
          cy="32"
          r={RADIUS}
          className="fill-none stroke-accent"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
        />
      </svg>
      <Fingerprint
        aria-hidden
        className={cn(
          "size-6 transition-colors",
          holding ? "text-accent" : "text-muted group-hover:text-foreground",
        )}
      />
    </button>
  );
}

function toPointerType(type: string): "mouse" | "pen" | "touch" | null {
  return type === "mouse" || type === "pen" || type === "touch" ? type : null;
}
