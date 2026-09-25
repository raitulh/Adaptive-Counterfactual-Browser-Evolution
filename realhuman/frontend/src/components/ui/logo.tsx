import { cn } from "@/lib/utils/cn";
import { siteConfig } from "@/lib/constants/site";

/**
 * Circular verification mark: a ring (the session), a check (the decision) and
 * a single green node on the ring (the verified signal).
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={cn("size-6", className)}>
      <circle
        cx="12"
        cy="12"
        r="9.5"
        stroke="currentColor"
        strokeOpacity="0.92"
        strokeWidth="1.6"
      />
      <path
        d="M8.2 12.3l2.6 2.6 5-5.3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="18.72"
        cy="5.28"
        r="2.4"
        className="fill-success stroke-background"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function Logo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-foreground", className)}>
      <LogoMark />
      {showWordmark ? (
        <span className="text-[15px] font-semibold tracking-[-0.02em]">{siteConfig.name}</span>
      ) : (
        <span className="sr-only">{siteConfig.name}</span>
      )}
    </span>
  );
}
