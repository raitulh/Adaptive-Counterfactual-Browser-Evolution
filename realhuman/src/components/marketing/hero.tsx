import { CircleDot } from "lucide-react";
import Link from "next/link";
import { Button, ButtonArrow } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { HeroVisual } from "@/components/visuals/hero-visual";
import { hero } from "@/lib/constants/content";
import { routes } from "@/lib/constants/site";

/**
 * Hero copy renders on the server and animates in with CSS only, so the
 * largest contentful paint never waits for JavaScript. The visual is a
 * client island that enhances progressively.
 */
export function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative isolate overflow-hidden pt-(--nav-height)"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid" />
        <div className="absolute top-[-20%] left-1/2 h-[60rem] w-[80rem] -translate-x-1/2 [--glow:rgb(94_169_247/0.09)] glow" />
        <div className="absolute inset-0 grain" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background" />
      </div>

      <Container
        size="wide"
        className="grid items-center gap-10 pt-12 pb-16 sm:pt-16 lg:min-h-[calc(100svh-var(--nav-height))] lg:grid-cols-[1.05fr_1fr] lg:gap-6 lg:py-16"
      >
        <div className="flex flex-col items-start gap-7">
          <p className="inline-flex animate-rise-in items-center gap-2 rounded-pill border border-border-strong bg-surface/70 py-1 pr-3 pl-2 font-mono text-[11px] tracking-[0.14em] text-muted uppercase backdrop-blur">
            <CircleDot aria-hidden className="size-3.5 text-accent" />
            {hero.badge}
          </p>

          <h1 id="hero-title" className="max-w-[13ch] animate-settle text-display text-balance">
            {hero.headlineLead}{" "}
            <span className="text-gradient-verified">{hero.headlineEmphasis}</span>
          </h1>

          <p className="max-w-xl animate-settle text-body-lg text-pretty text-muted [animation-delay:60ms]">
            {hero.body}
          </p>

          <div className="flex w-full animate-rise-in flex-col gap-3 [animation-delay:210ms] sm:w-auto sm:flex-row">
            <Button asChild size="lg">
              <Link href={routes.signup}>
                Start Building
                <ButtonArrow />
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href={routes.demo}>View Demo</Link>
            </Button>
          </div>

          <ul
            aria-label="Product principles"
            className="flex animate-rise-in flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-subtle [animation-delay:280ms]"
          >
            {hero.trust.map((item, index) => (
              <li key={item} className="flex items-center gap-4">
                {index > 0 ? (
                  <span aria-hidden className="hidden size-1 rounded-full bg-faint sm:block" />
                ) : null}
                {item}
              </li>
            ))}
          </ul>
        </div>

        <HeroVisual className="w-full animate-rise-in [animation-delay:200ms] lg:pl-6" />
      </Container>
    </section>
  );
}
