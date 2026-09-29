import { cn } from "@/lib/utils";

/**
 * AgentOS mark: an execution core (inner node) inside an orbit (tools) with a verification arc.
 * Pure SVG, crisp at any size, no external assets.
 */
export function AgentCoreMark({ className, title = "AgentOS" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-6", className)} role="img" aria-label={title}>
      <defs>
        <radialGradient id="agentos-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#E9FEFF" />
          <stop offset="55%" stopColor="#5CE1E6" />
          <stop offset="100%" stopColor="#1B8C93" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="13" fill="none" stroke="rgb(255 255 255 / 0.14)" strokeWidth="1.25" />
      <path d="M16 3a13 13 0 0 1 12.2 8.5" fill="none" stroke="#A99BFF" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="28.2" cy="11.5" r="1.9" fill="#A99BFF" />
      <circle cx="5.2" cy="21.8" r="1.6" fill="rgb(255 255 255 / 0.55)" />
      <circle cx="16" cy="16" r="5.4" fill="url(#agentos-core)" />
      <circle cx="16" cy="16" r="8.4" fill="none" stroke="rgb(92 225 230 / 0.35)" strokeWidth="1" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight text-fg", className)}>
      <AgentCoreMark className="size-6" title="" />
      <span>
        Agent<span className="text-fg-muted">OS</span>
      </span>
    </span>
  );
}
