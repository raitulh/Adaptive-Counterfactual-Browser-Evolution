import * as React from "react";
import { cn } from "@/lib/utils";
import { highlightSegments } from "./highlight";

/** Renders text with query terms wrapped in <mark> (screen readers announce them as highlighted). */
export function HighlightText({ text, terms, className }: { text: string; terms: string[]; className?: string }) {
  const segments = React.useMemo(() => highlightSegments(text, terms), [text, terms]);
  return (
    <span className={className}>
      {segments.map((s, i) =>
        s.match ? (
          <mark key={i} className={cn("rounded-[3px] bg-accent/15 px-0.5 text-fg ring-1 ring-accent/25")}>
            {s.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{s.text}</React.Fragment>
        ),
      )}
    </span>
  );
}
