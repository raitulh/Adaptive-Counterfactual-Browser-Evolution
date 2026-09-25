import { ArrowRight, Check, Minus } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { problem } from "@/lib/constants/content";

/** Legacy grid challenge rendered abstractly — no literal CAPTCHA imagery. */
function LegacyGlyph() {
  return (
    <div aria-hidden className="grid grid-cols-3 gap-1.5">
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          className={`size-7 rounded-[5px] border ${[1, 5, 6].includes(i) ? "border-border-bright bg-surface-hover" : "border-border bg-surface-raised"}`}
        />
      ))}
    </div>
  );
}

function SignalGlyph() {
  const bars = [0.94, 0.9, 0.86, 0.8];
  return (
    <div aria-hidden className="flex w-28 flex-col gap-2">
      {bars.map((value, i) => (
        <span key={i} className="h-1 overflow-hidden rounded-full bg-surface-overlay">
          <span
            className="block h-full rounded-full bg-accent/70"
            style={{ width: `${value * 100}%` }}
          />
        </span>
      ))}
    </div>
  );
}

export function ProblemSection() {
  return (
    <section id="problem" aria-labelledby="problem-title" className="py-section">
      <Container size="wide">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
          <div className="flex flex-col gap-8">
            <SectionHeading
              id="problem-title"
              eyebrow={problem.eyebrow}
              title={problem.title}
              description={problem.body}
            />
            <Reveal delay={0.1}>
              <ul aria-label="Kinds of automation" className="flex flex-wrap gap-2">
                {problem.actors.map((actor) => (
                  <li
                    key={actor}
                    className="rounded-pill border border-border-strong bg-surface px-3 py-1 font-mono text-xs text-muted"
                  >
                    {actor}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <Reveal delay={0.1} y={20} className="flex flex-col gap-4">
            <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
              <div className="flex flex-col gap-5 rounded-2xl border border-border bg-surface/60 p-6">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-h3 text-muted">{problem.legacy.title}</h3>
                  <LegacyGlyph />
                </div>
                <ul className="flex flex-col gap-2.5">
                  {problem.legacy.points.map((point) => (
                    <li key={point} className="flex items-start gap-2.5 text-sm text-subtle">
                      <Minus aria-hidden className="mt-0.5 size-4 shrink-0 text-faint" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>

              <div aria-hidden className="flex items-center justify-center">
                <span className="inline-flex size-9 rotate-90 items-center justify-center rounded-full border border-border-strong bg-surface text-muted md:rotate-0">
                  <ArrowRight className="size-4" />
                </span>
              </div>

              <div className="flex flex-col gap-5 rounded-2xl border border-accent/25 bg-surface p-6 shadow-[0_0_0_1px_rgb(94_169_247/0.08),0_20px_60px_-30px_rgb(94_169_247/0.45)]">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-h3">{problem.modern.title}</h3>
                  <SignalGlyph />
                </div>
                <ul className="flex flex-col gap-2.5">
                  {problem.modern.points.map((point) => (
                    <li key={point} className="flex items-start gap-2.5 text-sm text-foreground/90">
                      <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="text-sm text-subtle">{problem.footnote}</p>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
