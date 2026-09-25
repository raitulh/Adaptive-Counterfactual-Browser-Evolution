"use client";

import { m, useScroll, useSpring } from "framer-motion";
import { useRef } from "react";
import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { SectionHeading } from "@/components/ui/section-heading";
import { steps } from "@/lib/constants/content";

/**
 * Three steps joined by a line that fills as the section scrolls through the
 * viewport. Horizontal on desktop, vertical on mobile.
 */
export function HowItWorks() {
  const listRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: listRef, offset: ["start 85%", "end 55%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 });

  return (
    <section id="how-it-works" aria-labelledby="how-title" className="py-section">
      <Container size="wide">
        <SectionHeading
          id="how-title"
          eyebrow="How it works"
          title="Challenge. Analyze. Verify."
          description="Every verification follows the same three steps, whether the session is a person at a keyboard or automation that needs a closer look."
        />

        <div ref={listRef} className="relative mt-14">
          {/* Track + progress: vertical on mobile, horizontal on md+ */}
          <div
            aria-hidden
            className="absolute top-2 bottom-2 left-[19px] w-px bg-border md:top-[19px] md:right-[16.66%] md:bottom-auto md:left-[16.66%] md:h-px md:w-auto"
          />
          <m.div
            aria-hidden
            style={{ scaleY: progress }}
            className="absolute top-2 bottom-2 left-[19px] w-px origin-top bg-accent md:hidden"
          />
          <m.div
            aria-hidden
            style={{ scaleX: progress }}
            className="absolute top-[19px] right-[16.66%] left-[16.66%] hidden h-px origin-left bg-accent md:block"
          />

          <ol className="relative grid gap-10 md:grid-cols-3 md:gap-6">
            {steps.map(({ number, title, body, icon: Icon, detail }, index) => (
              <li key={number} className="relative pl-14 md:pl-0 md:text-center">
                <Reveal delay={index * 0.08} className="flex flex-col gap-4 md:items-center">
                  <span className="absolute top-0 left-0 inline-flex size-10 items-center justify-center rounded-full border border-border-strong bg-background text-foreground shadow-subtle md:relative">
                    <Icon aria-hidden className="size-[18px]" />
                  </span>
                  <div className="flex flex-col gap-2 md:items-center">
                    <p className="font-mono text-xs text-subtle">{number}</p>
                    <h3 className="text-h3">{title}</h3>
                    <p className="max-w-sm text-sm text-muted">{body}</p>
                    <code className="mt-1 w-fit rounded-md border border-border bg-surface px-2 py-1 font-mono text-[11px] text-subtle">
                      {detail}
                    </code>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </section>
  );
}
