import { Check, Sigma } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";
import { Meter } from "@/components/ui/meter";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { SignalBadge } from "@/components/ui/status-badge";
import { signalEngine } from "@/lib/constants/content";
import { formatScore } from "@/lib/utils/format";
import { DEFAULT_POLICY, decide, makeSignal } from "@/lib/verification/scoring";
import { SIGNALS } from "@/lib/verification/signals";

const SAMPLE_SCORES = [0.94, 0.91, 0.88, 0.79] as const;
const SAMPLE_SIGNALS = SIGNALS.map((definition, index) =>
  makeSignal(definition.id, SAMPLE_SCORES[index]!),
);
const SAMPLE_DECISION = decide(SAMPLE_SIGNALS);

export function SignalEngine() {
  return (
    <section id="signal-engine" aria-labelledby="signal-title" className="py-section">
      <Container size="wide">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div className="flex flex-col gap-8 lg:sticky lg:top-28 lg:self-start">
            <SectionHeading
              id="signal-title"
              eyebrow={signalEngine.eyebrow}
              title={signalEngine.title}
              description={signalEngine.body}
            />
            <Reveal delay={0.1}>
              <ul className="flex flex-col gap-3">
                {signalEngine.points.map((point) => (
                  <li key={point} className="flex items-start gap-3 text-sm text-foreground/90">
                    <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
                    {point}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <Reveal y={24} delay={0.05}>
            <figure className="overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-elevated">
              <figcaption className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
                <span className="flex items-center gap-3 font-mono text-xs">
                  <span className="text-foreground">signal_engine</span>
                  <span className="text-subtle">sess_4c1e…9a02</span>
                </span>
                <Badge tone="warning" size="sm">
                  Sample data
                </Badge>
              </figcaption>

              <div className="grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,0.8fr)]">
                <ul className="flex flex-col divide-y divide-border">
                  {SAMPLE_SIGNALS.map((signal, index) => {
                    const definition = SIGNALS[index]!;
                    return (
                      <li key={signal.id} className="flex flex-col gap-2.5 px-5 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="text-sm font-medium">{signal.label}</span>
                            <span className="truncate font-mono text-[11px] text-subtle">
                              {definition.key}
                            </span>
                          </div>
                          <SignalBadge status={signal.status} />
                        </div>
                        <Meter
                          value={signal.score}
                          delay={index * 0.08}
                          label={`${signal.label} sample score`}
                        />
                        <div className="flex justify-between font-mono text-[11px] text-subtle tabular-nums">
                          <span>weight {signal.weight.toFixed(2)}</span>
                          <span className="text-muted">{formatScore(signal.score)}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <div
                  aria-hidden
                  className="flex items-center justify-center border-y border-border py-3 lg:border-x lg:border-y-0 lg:px-3 lg:py-0"
                >
                  <span className="inline-flex size-9 items-center justify-center rounded-full border border-border-strong bg-surface-raised text-muted">
                    <Sigma className="size-4" />
                  </span>
                </div>

                <div className="flex flex-col gap-5 p-5">
                  <div className="flex flex-col gap-3">
                    <p className="eyebrow">Policy</p>
                    <div className="relative pt-5">
                      <div className="flex h-2 overflow-hidden rounded-full">
                        <span
                          className="bg-danger/25"
                          style={{ width: `${DEFAULT_POLICY.stepUpAt * 100}%` }}
                        />
                        <span
                          className="bg-warning/25"
                          style={{
                            width: `${(DEFAULT_POLICY.allowAt - DEFAULT_POLICY.stepUpAt) * 100}%`,
                          }}
                        />
                        <span className="flex-1 bg-surface-hover" />
                      </div>
                      <span
                        aria-hidden
                        className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
                        style={{ left: `${SAMPLE_DECISION.score * 100}%` }}
                      >
                        <span className="font-mono text-[10px] text-success">
                          {formatScore(SAMPLE_DECISION.score)}
                        </span>
                        <span className="mt-0.5 h-4 w-px bg-success" />
                      </span>
                      <div className="mt-2 flex justify-between font-mono text-[10px] text-subtle">
                        <span>deny</span>
                        <span>step-up ≥ {DEFAULT_POLICY.stepUpAt.toFixed(2)}</span>
                        <span>allow ≥ {DEFAULT_POLICY.allowAt.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-3 border-t border-border pt-5 text-sm">
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs text-subtle">Aggregate score</dt>
                      <dd className="font-mono text-lg tabular-nums">
                        {formatScore(SAMPLE_DECISION.score)}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs text-subtle">Risk</dt>
                      <dd className="font-mono text-lg capitalize">{SAMPLE_DECISION.risk}</dd>
                    </div>
                  </dl>

                  <div className="mt-auto flex items-center gap-3 rounded-xl border border-success/30 bg-success/[0.07] px-4 py-3.5">
                    <span className="inline-flex size-8 items-center justify-center rounded-full bg-success text-inverse-foreground">
                      <Check aria-hidden className="size-4" strokeWidth={3} />
                    </span>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-success">
                        Decision: {SAMPLE_DECISION.decision}
                      </span>
                      <span className="font-mono text-[11px] text-subtle">
                        4 of 4 signals · token issued
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </figure>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
