import * as React from "react";
import type {
  ApprovalStatus,
  ConnectionStatus,
  PermissionLevel,
  RiskLevel,
  StepStatus,
  TaskStatus,
  VerificationStatus,
} from "@/lib/api";
import {
  approvalStatusMeta,
  connectionStatusMeta,
  permissionLevelMeta,
  riskLevelMeta,
  stepStatusMeta,
  taskStatusMeta,
  toneClasses,
  verificationStatusMeta,
  type StatusMeta,
  type Tone,
} from "@/lib/status";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  variant?: "soft" | "outline" | "solid";
  size?: "sm" | "md";
}

export function Badge({ tone = "neutral", variant = "soft", size = "sm", className, ...props }: BadgeProps) {
  const t = toneClasses[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium",
        size === "sm" ? "h-5 px-2 text-2xs" : "h-6 px-2.5 text-xs",
        variant === "soft" && [t.soft, t.text, t.border],
        variant === "outline" && ["bg-transparent", t.text, t.border],
        variant === "solid" && [t.bg, "border-transparent text-bg"],
        className,
      )}
      {...props}
    />
  );
}

/** Pulsing dot for live states (paired with text — never the only signal). */
export function LiveDot({ tone = "accent", live = true, className }: { tone?: Tone; live?: boolean; className?: string }) {
  const t = toneClasses[tone];
  return (
    <span className={cn("relative inline-flex size-1.5 shrink-0", className)} aria-hidden>
      {live && <span className={cn("absolute inset-0 rounded-full motion-safe:animate-pulse-ring", t.dot)} />}
      <span className={cn("relative inline-flex size-1.5 rounded-full", t.dot)} />
    </span>
  );
}

type StatusKind =
  | { kind: "task"; value: TaskStatus }
  | { kind: "step"; value: StepStatus }
  | { kind: "approval"; value: ApprovalStatus }
  | { kind: "verification"; value: VerificationStatus }
  | { kind: "connection"; value: ConnectionStatus };

function metaFor(p: StatusKind): StatusMeta {
  switch (p.kind) {
    case "task":
      return taskStatusMeta[p.value];
    case "step":
      return stepStatusMeta[p.value];
    case "approval":
      return approvalStatusMeta[p.value];
    case "verification":
      return verificationStatusMeta[p.value];
    case "connection":
      return connectionStatusMeta[p.value];
  }
}

const UNKNOWN: StatusMeta = { label: "Unknown", tone: "neutral", description: "Unrecognized status" };

/** Semantic status: color + text + (for live states) a pulsing dot, with the description as tooltip text. */
export function StatusBadge(props: StatusKind & { size?: "sm" | "md"; className?: string }) {
  const meta = metaFor(props) ?? UNKNOWN;
  return (
    <Badge tone={meta.tone} size={props.size} className={props.className} title={meta.description}>
      <LiveDot tone={meta.tone} live={Boolean(meta.live)} />
      {meta.label}
    </Badge>
  );
}

export function RiskBadge({ level, className }: { level: RiskLevel; className?: string }) {
  const meta = riskLevelMeta[level];
  return (
    <Badge tone={meta.tone} variant="outline" className={className} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function PermissionBadge({ level, className }: { level: PermissionLevel; className?: string }) {
  const meta = permissionLevelMeta[level];
  return (
    <Badge tone={meta.tone} variant="outline" className={cn("font-mono", className)} title={meta.description}>
      {meta.label}
    </Badge>
  );
}
