"use client";

import { useQuery } from "@tanstack/react-query";
import { CpuIcon, FlaskConicalIcon, TerminalSquareIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, LiveDot } from "@/components/ui/badge";
import { CodeBlock } from "@/components/ui/data-display";
import { PageContainer } from "@/components/ui/page";
import { adminApi } from "@/lib/api";
import { usePermissions } from "@/lib/auth/hooks";
import { qk } from "@/lib/query/keys";
import type { StatusMeta } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * Developer "lab" chrome shared by Evaluations, Experiments and the ACBE lab: a gridded header band,
 * monospace addressing and instrument-style panels — same tokens as the rest of the product.
 */
export function LabShell({ children }: { children: ReactNode }) {
  return <PageContainer width="wide">{children}</PageContainer>;
}

export function LabHeader({
  path,
  title,
  description,
  actions,
  icon,
  crumbs,
}: {
  path: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  crumbs?: Array<{ href: string; label: string }>;
}) {
  return (
    <header className="relative mb-6 overflow-hidden rounded-2xl border border-line bg-surface-1">
      <div
        className="pointer-events-none absolute inset-0 bg-grid [mask-image:linear-gradient(to_right,black,transparent_85%)] opacity-60"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -top-24 -left-24 size-64 rounded-full bg-verify/10 blur-3xl"
        aria-hidden
      />
      <div className="relative flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2 font-mono text-2xs text-fg-subtle">
            <span className="inline-flex items-center gap-1.5 rounded border border-verify/30 bg-verify/10 px-1.5 py-0.5 tracking-wider text-verify uppercase">
              <FlaskConicalIcon className="size-3" aria-hidden /> Lab
            </span>
            {crumbs?.map((c) => (
              <span key={c.href} className="inline-flex items-center gap-2">
                <Link href={c.href} className="hover:text-fg hover:underline">
                  {c.label}
                </Link>
                <span aria-hidden>/</span>
              </span>
            ))}
            <span className="truncate">{path}</span>
          </div>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-fg sm:text-[28px]">
            {icon && <span className="text-verify [&_svg]:size-6">{icon}</span>}
            <span className="min-w-0 break-words">{title}</span>
          </h1>
          {description && <div className="mt-1.5 max-w-3xl text-sm leading-relaxed text-fg-muted">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function LabPanel({
  title,
  meta,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-t` : undefined}
      className={cn("overflow-hidden rounded-xl border border-line bg-surface-1", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2/50 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-1.5 shrink-0 rounded-full bg-verify/70" aria-hidden />
          <h2
            id={id ? `${id}-t` : undefined}
            className="truncate font-mono text-xs font-medium tracking-wider text-fg-muted uppercase"
          >
            {title}
          </h2>
          {meta && <span className="truncate font-mono text-2xs text-fg-subtle">{meta}</span>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Instrument-style readout: label, mono value, optional sub-label; tone colors only the marker. */
export function Readout({
  label,
  value,
  sub,
  tone,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "success" | "danger" | "warning" | "neutral" | "verify" | "accent";
  className?: string;
}) {
  const bar = {
    success: "bg-success",
    danger: "bg-danger",
    warning: "bg-warning",
    neutral: "bg-fg-subtle/40",
    verify: "bg-verify",
    accent: "bg-accent",
  }[tone ?? "neutral"];
  return (
    <div
      className={cn("relative flex flex-col gap-1 rounded-lg border border-line bg-bg/40 py-2.5 pr-3 pl-4", className)}
    >
      <span className={cn("absolute inset-y-2 left-1.5 w-[3px] rounded-full", bar)} aria-hidden />
      <span className="text-2xs tracking-wider text-fg-subtle uppercase">{label}</span>
      <span className="font-mono text-lg font-semibold tracking-tight text-fg tabular-nums">{value}</span>
      {sub && <span className="text-2xs text-fg-subtle">{sub}</span>}
    </div>
  );
}

export function LabStatusBadge({ meta, size }: { meta: StatusMeta; size?: "sm" | "md" }) {
  return (
    <Badge tone={meta.tone} size={size} title={meta.description}>
      <LiveDot tone={meta.tone} live={Boolean(meta.live)} />
      {meta.label}
    </Badge>
  );
}

/** Tri-state gate check: passed / failed / not applicable. */
export function CheckMark({ ok, label }: { ok: boolean | null | undefined; label?: string }) {
  if (ok === null || ok === undefined) return <span className="font-mono text-xs text-fg-subtle">n/a</span>;
  return (
    <span className={cn("inline-flex items-center gap-1 font-mono text-xs", ok ? "text-success" : "text-danger")}>
      <span aria-hidden>{ok ? "✓" : "✗"}</span>
      {label ?? (ok ? "pass" : "fail")}
    </span>
  );
}

/**
 * Honest explanation of queued evaluation work: it only runs on a dedicated evaluation worker.
 * Platform administrators also see whether one is currently alive (from the system overview).
 */
export function EvaluationWorkerNotice({ pending, className }: { pending: boolean; className?: string }) {
  const { isPlatformAdmin } = usePermissions();
  const system = useQuery({
    queryKey: qk.admin.system,
    queryFn: ({ signal }) => adminApi.system({ signal }),
    enabled: isPlatformAdmin,
    refetchInterval: pending ? 15_000 : false,
    staleTime: 10_000,
  });
  const rawWorkers = system.data?.workers;
  const workers = Array.isArray(rawWorkers) ? (rawWorkers as Array<Record<string, unknown>>) : [];
  const evalWorkers = workers.filter(
    (w) => Array.isArray(w.queues) && w.queues.length === 1 && w.queues[0] === "evaluation",
  );
  const alive = evalWorkers.filter((w) => w.alive === true);
  const known = isPlatformAdmin && system.isSuccess;

  if (!pending && (!known || alive.length > 0)) return null;
  const offline = known && alive.length === 0;
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-3 rounded-xl border px-4 py-3 text-[13px] sm:flex-row sm:items-start",
        offline ? "border-warning/30 bg-warning/[0.06]" : "border-line bg-surface-1",
        className,
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border",
          offline ? "border-warning/30 text-warning" : "border-line-strong text-fg-muted",
        )}
      >
        <CpuIcon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-fg">
          {offline
            ? "No evaluation worker is running — queued work will wait"
            : known
              ? `Evaluation worker online (${alive.length})`
              : "Queued work runs on a dedicated evaluation worker"}
        </p>
        <p className="mt-0.5 text-fg-muted">
          Evaluations execute cases against simulated providers, so they never run inside the API or the regular task
          workers. They stay <span className="font-mono text-fg">queued</span> until a worker started with only the{" "}
          <span className="font-mono text-fg">evaluation</span> queue picks them up
          {known ? "" : " — if nothing moves, ask your platform administrator whether one is running"}.
        </p>
        {offline && (
          <div className="mt-2">
            <CodeBlock>agentos-worker --queues evaluation --concurrency 1</CodeBlock>
          </div>
        )}
      </div>
      {known && (
        <Link
          href="/app/admin"
          className="inline-flex shrink-0 items-center gap-1 self-start text-xs text-accent hover:underline"
        >
          <TerminalSquareIcon className="size-3.5" aria-hidden /> System status
        </Link>
      )}
    </div>
  );
}
