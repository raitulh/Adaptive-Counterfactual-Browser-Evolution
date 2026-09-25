import { CircleCheck, Inbox, RotateCcw, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/utils/cn";

interface StateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  icon?: LucideIcon;
}

function StateFrame({
  icon: Icon,
  tone,
  title,
  description,
  action,
  className,
  role,
}: StateProps & {
  icon: LucideIcon;
  tone: "neutral" | "warning" | "success";
  role?: "alert" | "status";
}) {
  return (
    <div
      role={role}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-strong px-6 py-12 text-center",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex size-10 items-center justify-center rounded-full border",
          tone === "neutral" && "border-border-strong bg-surface-raised text-muted",
          tone === "warning" && "border-warning/25 bg-warning/10 text-warning",
          tone === "success" && "border-success/25 bg-success/10 text-success",
        )}
      >
        <Icon className="size-[18px]" />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-[15px] font-medium text-foreground">{title}</p>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function EmptyState({ icon = Inbox, ...props }: StateProps) {
  return <StateFrame icon={icon} tone="neutral" {...props} />;
}

export function ErrorState({
  onRetry,
  retryLabel = "Try again",
  ...props
}: StateProps & { onRetry?: () => void; retryLabel?: string }) {
  return (
    <StateFrame
      icon={props.icon ?? TriangleAlert}
      tone="warning"
      role="alert"
      action={
        props.action ??
        (onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RotateCcw aria-hidden />
            {retryLabel}
          </Button>
        ) : undefined)
      }
      {...props}
    />
  );
}

export function SuccessState(props: StateProps) {
  return <StateFrame icon={props.icon ?? CircleCheck} tone="success" role="status" {...props} />;
}

/** Skeleton rows for list/table loading states. */
export function LoadingState({
  rows = 4,
  label = "Loading",
  className,
}: {
  rows?: number;
  label?: string;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={cn("flex flex-col gap-2.5", className)}>
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-11 w-full" style={{ opacity: 1 - index * 0.14 }} />
      ))}
    </div>
  );
}
