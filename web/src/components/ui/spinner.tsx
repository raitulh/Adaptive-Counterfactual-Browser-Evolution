import { cn } from "@/lib/utils";

/** Small indeterminate spinner. Prefer contextual loading UI (skeletons, phase indicators) for pages. */
export function Spinner({ className, label, ...props }: React.SVGProps<SVGSVGElement> & { label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn("size-4 animate-spin text-current", className)}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...props}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
