import type { ReactNode } from "react";
import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/utils/cn";

interface SectionHeadingProps {
  id: string;
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  className?: string;
  children?: ReactNode;
}

/** Consistent section header: micro-label, h2, supporting copy. `id` labels the section. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  align = "left",
  className,
  children,
}: SectionHeadingProps) {
  return (
    <Reveal
      className={cn(
        "flex flex-col gap-4",
        align === "center" ? "mx-auto max-w-narrow items-center text-center" : "max-w-2xl",
        className,
      )}
    >
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={id} className="text-h2 text-balance">
        {title}
      </h2>
      {description ? <p className="text-body-lg text-pretty text-muted">{description}</p> : null}
      {children}
    </Reveal>
  );
}
