import { Info } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";
import { apiMode } from "@/lib/api/mode";

/** Shown in mock mode so sample data is never mistaken for production data. */
export function MockNotice({ children }: { children?: ReactNode }) {
  if (apiMode !== "mock") return null;
  return (
    <p className="flex items-start gap-2.5 rounded-lg border border-warning/20 bg-warning/[0.06] px-3.5 py-2.5 text-xs text-muted">
      <Info aria-hidden className="mt-px size-3.5 shrink-0 text-warning" />
      <span>
        {children ?? "Sample data from the mock adapter. Nothing here reflects real traffic."}{" "}
        <Link
          href="/docs#mock-mode"
          className="text-foreground underline decoration-border-bright underline-offset-4 hover:decoration-foreground"
        >
          About mock mode
        </Link>
      </span>
    </p>
  );
}
