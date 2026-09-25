"use client";

import { m, AnimatePresence } from "framer-motion";
import { Check, OctagonX, RotateCcw, ShieldAlert, Timer, WifiOff } from "lucide-react";
import { useId, type ReactNode } from "react";
import { HoldButton } from "@/components/demo/hold-button";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/ui/logo";
import { Spinner } from "@/components/ui/primitives";
import { useInteractionTelemetry } from "@/hooks/use-interaction-telemetry";
import type { VerificationDemo } from "@/hooks/use-verification-demo";
import { duration, ease, spring } from "@/lib/constants/motion";
import { cn } from "@/lib/utils/cn";
import { maskSecret } from "@/lib/utils/format";

type Props = Pick<
  VerificationDemo,
  "state" | "secondsLeft" | "start" | "submit" | "retry" | "runAgain"
>;

/** The embeddable widget as a site visitor would see it. */
export function VerificationWidget({ state, secondsLeft, start, submit, retry, runAgain }: Props) {
  const { status, session } = state;
  const resolved = state.signals.length;

  return (
    <div
      data-status={status}
      className={cn(
        "relative flex min-h-[5.5rem] items-center gap-4 rounded-xl border bg-surface-raised p-4 transition-[border-color,box-shadow] duration-500",
        status === "verified" ? "border-success/35 shadow-glow-success" : "border-border-strong",
        (status === "step_up" || status === "timeout" || status === "error") && "border-warning/30",
        status === "blocked" && "border-danger/30",
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <m.div
          key={status === "challenge" ? `challenge-${state.attempt}` : status}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-4 sm:flex-nowrap"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: duration.standard, ease: ease.outExpo }}
        >
          {status === "idle" ? (
            <>
              <Button
                onClick={() => void start()}
                variant="secondary"
                className="h-11 gap-2.5 px-4"
              >
                <LogoMark className="size-5" />
                Verify you&apos;re human
              </Button>
              <p className="hidden text-xs text-subtle sm:block">
                Takes a moment. No personal data.
              </p>
            </>
          ) : null}

          {status === "starting" ? (
            <StatusLine
              icon={<Spinner className="size-5 text-accent" />}
              title="Creating a session…"
            />
          ) : null}

          {status === "challenge" ? (
            <ChallengeControls
              key={`${state.runId}-${state.attempt}`}
              attempt={state.attempt}
              secondsLeft={secondsLeft}
              submit={submit}
            />
          ) : null}

          {status === "analyzing" ? (
            <StatusLine
              icon={<Spinner className="size-5 text-accent" />}
              title="Analyzing signals…"
              detail={`${resolved} of 4 signals resolved`}
            />
          ) : null}

          {status === "verified" ? (
            <>
              <m.span
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={spring.tactile}
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-success text-inverse-foreground"
              >
                <Check className="size-5" strokeWidth={3} aria-hidden />
              </m.span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-sm font-medium text-success" role="status">
                  Human verified
                </p>
                <p className="truncate font-mono text-[11px] text-subtle">
                  token {state.result?.token ? maskSecret(state.result.token) : "—"}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={runAgain}>
                <RotateCcw aria-hidden />
                Run again
              </Button>
            </>
          ) : null}

          {status === "step_up" ? (
            <Outcome
              icon={<ShieldAlert aria-hidden className="size-5" />}
              tone="warning"
              title="One more check needed"
              detail="Signals were inconclusive, so the policy asks for a step-up challenge."
              action={
                <Button size="sm" variant="secondary" onClick={retry}>
                  Continue
                </Button>
              }
            />
          ) : null}

          {status === "timeout" ? (
            <Outcome
              icon={<Timer aria-hidden className="size-5" />}
              tone="warning"
              title="Session expired"
              detail="Verification sessions are short-lived. Start a new one to continue."
              action={
                <Button size="sm" variant="secondary" onClick={() => void start()}>
                  Start over
                </Button>
              }
            />
          ) : null}

          {status === "error" ? (
            <Outcome
              icon={<WifiOff aria-hidden className="size-5" />}
              tone="warning"
              title="Couldn't reach the verification service"
              detail={state.error?.retryable ? "This is usually temporary." : state.error?.message}
              action={
                <Button size="sm" variant="secondary" onClick={retry}>
                  Retry
                </Button>
              }
            />
          ) : null}

          {status === "blocked" ? (
            <Outcome
              icon={<OctagonX aria-hidden className="size-5" />}
              tone="danger"
              title="Verification failed"
              detail="The signals for this session did not meet the policy."
              action={
                <Button size="sm" variant="secondary" onClick={runAgain}>
                  Start over
                </Button>
              }
            />
          ) : null}
        </m.div>
      </AnimatePresence>

      {session && status !== "idle" ? (
        <span className="sr-only" aria-live="polite">
          {status === "analyzing" ? "Analyzing signals" : ""}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The challenge itself. Mounted per attempt, so interaction telemetry (timing,
 * pointer approach, key repeat) starts fresh each time a challenge appears.
 */
function ChallengeControls({
  attempt,
  secondsLeft,
  submit,
}: Pick<VerificationDemo, "secondsLeft" | "submit"> & { attempt: number }) {
  const instructionsId = useId();
  const telemetry = useInteractionTelemetry();

  return (
    <>
      <HoldButton
        describedBy={instructionsId}
        telemetry={telemetry}
        onComplete={({ holdDurationMs, inputMethod }) =>
          void submit({
            type: "press_hold",
            inputMethod,
            holdDurationMs,
            telemetry: telemetry.snapshot(),
          })
        }
      />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium">
          {attempt > 0 ? "One more check — press and hold" : "Press and hold"}
        </p>
        <p id={instructionsId} className="text-xs text-subtle">
          Hold for about a second, or hold Space.{" "}
          {secondsLeft !== null ? (
            <span className="font-mono text-muted tabular-nums">Expires in {secondsLeft}s</span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={(event) => {
            telemetry.input(event.nativeEvent.isTrusted);
            void submit({
              type: "single_step",
              inputMethod: "assistive",
              holdDurationMs: 0,
              telemetry: telemetry.snapshot(),
            });
          }}
          className="w-fit rounded-sm text-xs text-muted underline decoration-border-bright underline-offset-4 transition-colors hover:text-foreground"
        >
          Use a single-step challenge instead
        </button>
      </div>
    </>
  );
}

function StatusLine({ icon, title, detail }: { icon: ReactNode; title: string; detail?: string }) {
  return (
    <>
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface">
        {icon}
      </span>
      <div className="flex flex-col gap-0.5" role="status">
        <p className="text-sm font-medium">{title}</p>
        {detail ? <p className="font-mono text-[11px] text-subtle">{detail}</p> : null}
      </div>
    </>
  );
}

function Outcome({
  icon,
  tone,
  title,
  detail,
  action,
}: {
  icon: ReactNode;
  tone: "warning" | "danger";
  title: string;
  detail?: string;
  action: ReactNode;
}) {
  return (
    <>
      <span
        className={cn(
          "inline-flex size-10 shrink-0 items-center justify-center rounded-full border",
          tone === "warning"
            ? "border-warning/30 bg-warning/10 text-warning"
            : "border-danger/30 bg-danger/10 text-danger",
        )}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5" role="alert">
        <p
          className={cn("text-sm font-medium", tone === "warning" ? "text-warning" : "text-danger")}
        >
          {title}
        </p>
        {detail ? <p className="text-xs text-subtle">{detail}</p> : null}
      </div>
      <div className="ml-14 shrink-0 sm:ml-0">{action}</div>
    </>
  );
}
