/**
 * Layout and typography primitives for the public site. Server-safe (no hooks).
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export function Container({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mx-auto w-full max-w-[1240px] px-5 sm:px-8", className)} {...props} />;
}

export function Section({
  className,
  containerClassName,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & { containerClassName?: string }) {
  return (
    <section className={cn("relative scroll-mt-20 py-24 md:py-36", className)} {...props}>
      <Container className={containerClassName}>{children}</Container>
    </section>
  );
}

/** Mono section label, e.g. "03 — Tools". */
export function Eyebrow({
  index,
  children,
  className,
}: {
  index?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn("flex items-center gap-3 font-mono text-2xs tracking-[0.22em] text-fg-subtle uppercase", className)}
    >
      {index && <span className="text-accent">{index}</span>}
      {index && <span className="h-px w-6 bg-line-strong" aria-hidden />}
      <span>{children}</span>
    </p>
  );
}

export function SectionHeading({
  as: Tag = "h2",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { as?: "h1" | "h2" | "h3" }) {
  return (
    <Tag
      className={cn(
        "text-[2.25rem] leading-[1.04] font-semibold tracking-[-0.035em] text-balance text-fg sm:text-display-sm md:text-[3.25rem]",
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}

export function Lede({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("max-w-2xl text-[17px] leading-relaxed text-pretty text-fg-muted md:text-lg", className)}
      {...props}
    />
  );
}

export function SectionHeader({
  index,
  eyebrow,
  title,
  lede,
  className,
  align = "left",
}: {
  index?: string;
  eyebrow: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  className?: string;
  align?: "left" | "center";
}) {
  return (
    <header
      data-reveal
      className={cn("flex flex-col gap-5", align === "center" && "items-center text-center", className)}
    >
      <Eyebrow index={index}>{eyebrow}</Eyebrow>
      <SectionHeading className={cn(align === "center" ? "max-w-3xl" : "max-w-3xl")}>{title}</SectionHeading>
      {lede && <Lede className={align === "center" ? "mx-auto" : undefined}>{lede}</Lede>}
    </header>
  );
}

/** A quiet panel: surface, hairline, faint top highlight. */
export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative rounded-2xl border border-line bg-surface-1/80 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.04)]",
        className,
      )}
      {...props}
    />
  );
}

/** Small mono key/value used in diagrams ("method: read_back"). */
export function Readout({
  label,
  value,
  className,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 font-mono text-2xs", className)}>
      <span className="text-fg-subtle">{label}</span>
      <span className={cn("text-fg-muted", valueClassName)}>{value}</span>
    </span>
  );
}

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // Structured data only; "<" is escaped so no markup can break out of the script element.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
