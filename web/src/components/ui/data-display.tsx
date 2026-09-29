"use client";

/** CopyButton, IdChip, RelativeTime, MetricCard, CodeBlock, JsonViewer, KeyValue. */
import { CheckIcon, ChevronRightIcon, CopyIcon } from "lucide-react";
import * as React from "react";
import { dateTime, relativeTime } from "@/lib/format";
import { cn, shortId } from "@/lib/utils";
import { Button, type ButtonProps } from "./button";
import { Tooltip } from "./tooltip";

export function CopyButton({
  value,
  label = "Copy",
  size = "icon-xs",
  className,
}: {
  value: string;
  label?: string;
  size?: ButtonProps["size"];
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      className={cn("text-fg-subtle", className)}
      aria-label={copied ? "Copied" : label}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
    </Button>
  );
}

/** Monospace identifier with copy. Shows a short form; the full value is in the tooltip. */
export function IdChip({
  id,
  label,
  className,
}: {
  id: string | null | undefined;
  label?: string;
  className?: string;
}) {
  if (!id) return <span className="font-mono text-xs text-fg-subtle">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-line bg-surface-2 pl-1.5 font-mono text-2xs text-fg-muted",
        className,
      )}
    >
      <Tooltip content={<span className="font-mono">{id}</span>}>
        <span tabIndex={0} className="outline-none">
          {label ? `${label} ` : ""}
          {shortId(id)}
        </span>
      </Tooltip>
      <CopyButton value={id} label={`Copy ${label ?? "id"}`} className="size-5" />
    </span>
  );
}

/** Relative time that updates itself; absolute time in the tooltip and <time dateTime>. */
export function RelativeTime({ value, className }: { value: string | null | undefined; className?: string }) {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const t = setInterval(force, 30_000);
    return () => clearInterval(t);
  }, []);
  if (!value) return <span className={className}>—</span>;
  return (
    <Tooltip content={dateTime(value)}>
      <time dateTime={value} className={cn("tabular-nums", className)} suppressHydrationWarning>
        {relativeTime(value)}
      </time>
    </Tooltip>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  icon,
  footer,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border border-line bg-surface-1 p-4", className)}>
      <div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
        <span>{label}</span>
        {icon && <span className="text-fg-subtle [&_svg]:size-4">{icon}</span>}
      </div>
      <div className="text-2xl font-semibold tracking-tight text-fg tabular-nums">{value}</div>
      {hint && <div className="text-xs text-fg-subtle">{hint}</div>}
      {footer}
    </div>
  );
}

export function CodeBlock({
  children,
  className,
  copy = true,
}: {
  children: string;
  className?: string;
  copy?: boolean;
}) {
  return (
    <div className={cn("group relative rounded-lg border border-line bg-bg", className)}>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-fg-muted">
        <code>{children}</code>
      </pre>
      {copy && (
        <CopyButton
          value={children}
          label="Copy code"
          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        />
      )}
    </div>
  );
}

function JsonNode({ name, value, depth }: { name?: string; value: unknown; depth: number }) {
  const [open, setOpen] = React.useState(depth < 1);
  const isObj = value !== null && typeof value === "object";
  const entries = isObj ? Object.entries(value as Record<string, unknown>) : [];
  const keyEl = name !== undefined && <span className="text-info">{JSON.stringify(name)}</span>;
  if (!isObj) {
    const color =
      typeof value === "string"
        ? "text-success"
        : typeof value === "number"
          ? "text-warning"
          : typeof value === "boolean"
            ? "text-verify"
            : "text-fg-subtle";
    return (
      <div className="pl-4">
        {keyEl}
        {keyEl && <span className="text-fg-subtle">: </span>}
        <span className={cn("break-all", color)}>{JSON.stringify(value)}</span>
      </div>
    );
  }
  const brackets = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  return (
    <div className="pl-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="-ml-4 inline-flex items-center rounded text-left hover:bg-white/5"
        aria-expanded={open}
      >
        <ChevronRightIcon
          className={cn("size-3.5 text-fg-subtle transition-transform", open && "rotate-90")}
          aria-hidden
        />
        {keyEl}
        {keyEl && <span className="text-fg-subtle">: </span>}
        <span className="text-fg-subtle">
          {brackets[0]}
          {!open && ` ${entries.length} ${entries.length === 1 ? "item" : "items"} ${brackets[1]}`}
        </span>
      </button>
      {open && (
        <>
          {entries.map(([k, v]) => (
            <JsonNode key={k} name={Array.isArray(value) ? undefined : k} value={v} depth={depth + 1} />
          ))}
          <div className="text-fg-subtle">{brackets[1]}</div>
        </>
      )}
    </div>
  );
}

/** Collapsible JSON tree for developer/advanced views (never the primary UI for normal users). */
export function JsonViewer({ value, className }: { value: unknown; className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-x-auto rounded-lg border border-line bg-bg p-3 pr-9 font-mono text-xs leading-relaxed",
        className,
      )}
    >
      <CopyButton value={JSON.stringify(value, null, 2)} label="Copy JSON" className="absolute top-1.5 right-1.5" />
      <div className="-ml-4">
        <JsonNode value={value} depth={0} />
      </div>
    </div>
  );
}

export function KeyValue({
  items,
  className,
}: {
  items: Array<[React.ReactNode, React.ReactNode]>;
  className?: string;
}) {
  return (
    <dl className={cn("grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-[13px]", className)}>
      {items.map(([k, v], i) => (
        <React.Fragment key={i}>
          <dt className="text-fg-subtle">{k}</dt>
          <dd className="min-w-0 break-words text-fg">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
