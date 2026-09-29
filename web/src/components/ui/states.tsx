"use client";

/** EmptyState, ErrorState (API-error aware), PermissionDenied, InlineError. */
import { AlertOctagonIcon, CloudOffIcon, LockIcon, RefreshCwIcon, SearchXIcon, TimerIcon } from "lucide-react";
import * as React from "react";
import { normalizeError, type AgentOSApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { CopyButton } from "./data-display";

export interface EmptyStateProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  /** Optional visual (e.g. a 3D or illustrated element) rendered above the text. */
  visual?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
}

/** Meaningful empty states — never "No data found". */
export function EmptyState({ title, description, icon, visual, action, className, size = "md" }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "sm" ? "gap-2 py-8" : size === "md" ? "gap-3 py-14" : "gap-4 py-24",
        className,
      )}
    >
      {visual}
      {!visual && icon && (
        <div className="flex size-11 items-center justify-center rounded-xl border border-line-strong bg-surface-2 text-fg-muted [&_svg]:size-5">
          {icon}
        </div>
      )}
      <div className="max-w-md">
        <h3 className={cn("font-semibold tracking-tight text-fg", size === "lg" ? "text-xl" : "text-base")}>{title}</h3>
        {description && <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{description}</p>}
      </div>
      {action && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

export function RequestId({ id, className }: { id: string | null | undefined; className?: string }) {
  if (!id) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 font-mono text-2xs text-fg-subtle", className)}>
      Request ID {id.slice(0, 12)}
      <CopyButton value={id} label="Copy request ID" size="icon-xs" />
    </span>
  );
}

export function PermissionDenied({ error, className }: { error?: AgentOSApiError; className?: string }) {
  const missing = error?.missingPermissions ?? [];
  return (
    <EmptyState
      className={className}
      icon={<LockIcon />}
      title="You don't have permission to do this"
      description={
        <>
          Your role in this organization doesn&apos;t include access to this area.
          {missing.length > 0 && (
            <>
              {" "}
              Required: <span className="font-mono text-fg">{missing.join(", ")}</span>.
            </>
          )}{" "}
          Ask an organization owner or admin if you need it.
          {error?.requestId && (
            <span className="mt-2 block">
              <RequestId id={error.requestId} />
            </span>
          )}
        </>
      }
    />
  );
}

/** Renders any thrown value as a human-friendly, actionable error. */
export function ErrorState({
  error,
  onRetry,
  title,
  className,
  compact,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
  compact?: boolean;
}) {
  const e = normalizeError(error);
  if (e.kind === "forbidden") return <PermissionDenied error={e} className={className} />;
  const icon =
    e.kind === "not_found" ? <SearchXIcon /> : e.kind === "network" || e.kind === "unavailable" ? <CloudOffIcon /> : e.kind === "rate_limited" ? <TimerIcon /> : <AlertOctagonIcon />;
  const heading =
    title ??
    (e.kind === "not_found"
      ? "Not found"
      : e.kind === "network"
        ? "Can't reach AgentOS"
        : e.kind === "unavailable"
          ? "Temporarily unavailable"
          : e.kind === "rate_limited"
            ? "Slow down a little"
            : "Something went wrong");
  return (
    <EmptyState
      className={className}
      size={compact ? "sm" : "md"}
      icon={icon}
      title={heading}
      description={
        <>
          {e.userMessage}
          {e.requestId && (
            <span className="mt-2 block">
              <RequestId id={e.requestId} />
            </span>
          )}
        </>
      }
      action={
        onRetry && e.kind !== "not_found" ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            <RefreshCwIcon /> Try again
          </Button>
        ) : undefined
      }
    />
  );
}

/** One-line error for forms and inline actions. */
export function InlineError({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const e = normalizeError(error);
  return (
    <div role="alert" className={cn("flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/8 px-3 py-2 text-[13px] text-danger", className)}>
      <AlertOctagonIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p>{e.userMessage}</p>
        {e.requestId && <RequestId id={e.requestId} className="mt-0.5" />}
      </div>
    </div>
  );
}
