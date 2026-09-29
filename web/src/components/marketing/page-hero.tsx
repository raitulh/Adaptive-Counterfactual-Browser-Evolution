import * as React from "react";
import { cn } from "@/lib/utils";
import { Container, Eyebrow } from "./primitives";

/** Header for secondary marketing pages: one h1, a lede, optional actions and a visual. */
export function PageHero({
  eyebrow,
  title,
  lede,
  actions,
  visual,
  className,
}: {
  eyebrow: string;
  title: React.ReactNode;
  lede: React.ReactNode;
  actions?: React.ReactNode;
  visual?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("relative overflow-hidden border-b border-line", className)}>
      <div
        className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(70%_60%_at_70%_30%,black,transparent)] opacity-40"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -top-40 right-[-10%] size-[640px] rounded-full bg-[radial-gradient(closest-side,rgb(92_225_230/0.10),transparent)]"
        aria-hidden
      />
      <Container
        className={cn(
          "relative grid items-center gap-10 pt-32 pb-20 md:pt-40 md:pb-28",
          visual && "lg:grid-cols-[1.15fr_1fr]",
        )}
      >
        <div>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="mt-6 text-[clamp(2.5rem,5.4vw,4.5rem)] leading-[1] font-semibold tracking-[-0.045em] text-balance text-fg">
            {title}
          </h1>
          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-pretty text-fg-muted md:text-lg">{lede}</p>
          {actions && <div className="mt-9 flex flex-wrap gap-3">{actions}</div>}
        </div>
        {visual && <div className="mx-auto w-full max-w-[520px]">{visual}</div>}
      </Container>
    </section>
  );
}

/** Sticky in-page navigation for long documents. */
export function OnThisPage({ items, className }: { items: Array<{ id: string; label: string }>; className?: string }) {
  return (
    <nav aria-label="On this page" className={cn("text-sm", className)}>
      <p className="font-mono text-[10.5px] tracking-[0.2em] text-fg-subtle uppercase">On this page</p>
      <ul className="mt-4 flex flex-col gap-2 border-l border-line">
        {items.map((i) => (
          <li key={i.id}>
            <a
              href={`#${i.id}`}
              className="-ml-px block border-l border-transparent pl-4 text-fg-muted transition-colors hover:border-fg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
            >
              {i.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A titled block within a long page. */
export function DocSection({
  id,
  index,
  title,
  lede,
  children,
  className,
}: {
  id: string;
  index?: string;
  title: string;
  lede?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn("scroll-mt-24 border-t border-line pt-14 pb-4 first:border-t-0 first:pt-0", className)}
    >
      {index && <p className="font-mono text-2xs tracking-[0.22em] text-accent uppercase">{index}</p>}
      <h2
        id={`${id}-title`}
        className="mt-3 text-[1.9rem] leading-[1.08] font-semibold tracking-[-0.03em] text-balance text-fg md:text-[2.3rem]"
      >
        {title}
      </h2>
      {lede && <p className="mt-4 max-w-2xl text-[16.5px] leading-relaxed text-pretty text-fg-muted">{lede}</p>}
      {children && <div className="mt-8">{children}</div>}
    </section>
  );
}

/** Two-column fact list: term + explanation. */
export function FactList({
  items,
  className,
}: {
  items: Array<{ term: React.ReactNode; body: React.ReactNode }>;
  className?: string;
}) {
  return (
    <dl className={cn("grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2", className)}>
      {items.map((it, i) => (
        <div key={i} className="flex flex-col gap-2 bg-surface-1 p-5">
          <dt className="text-[15px] font-semibold tracking-tight text-fg">{it.term}</dt>
          <dd className="text-sm leading-relaxed text-fg-muted">{it.body}</dd>
        </div>
      ))}
    </dl>
  );
}
