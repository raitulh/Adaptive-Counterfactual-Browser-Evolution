"use client";

import { ArrowRightIcon, CheckCircle2Icon, ChevronsUpDownIcon } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  formatFieldValue,
  SECTION_LABELS,
  toDisplayBlocks,
  type DiffBlock,
  type FieldDiff,
  type LineOp,
  type SectionDiff,
  type VersionDiff,
} from "./version-diff";

function LineRow({ op }: { op: LineOp }) {
  const sign = op.type === "add" ? "+" : op.type === "remove" ? "−" : " ";
  return (
    <tr
      className={cn(
        op.type === "add" && "bg-success/[0.09]",
        op.type === "remove" && "bg-danger/[0.09]",
      )}
    >
      <td className="w-10 select-none border-r border-line px-2 text-right align-top text-fg-subtle/70 tabular-nums">{op.oldNo ?? ""}</td>
      <td className="w-10 select-none border-r border-line px-2 text-right align-top text-fg-subtle/70 tabular-nums">{op.newNo ?? ""}</td>
      <td
        className={cn(
          "w-5 select-none pl-2 align-top",
          op.type === "add" && "text-success",
          op.type === "remove" && "text-danger",
        )}
        aria-hidden
      >
        {sign}
      </td>
      <td className={cn("whitespace-pre-wrap break-words py-px pr-3 align-top", op.type === "equal" ? "text-fg-muted" : "text-fg")}>
        <span className="sr-only">{op.type === "add" ? "Added: " : op.type === "remove" ? "Removed: " : ""}</span>
        {op.text || " "}
      </td>
    </tr>
  );
}

function CollapsedRows({ block }: { block: DiffBlock }) {
  const [open, setOpen] = React.useState(false);
  if (open) return <>{block.ops.map((op, i) => <LineRow key={i} op={op} />)}</>;
  return (
    <tr className="bg-surface-2/60">
      <td colSpan={4} className="px-2 py-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-2xs text-info hover:bg-info/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <ChevronsUpDownIcon className="size-3" aria-hidden />
          Show {block.ops.length} unchanged {block.ops.length === 1 ? "line" : "lines"}
        </button>
      </td>
    </tr>
  );
}

export function InstructionsDiff({ ops }: { ops: LineOp[] }) {
  const blocks = React.useMemo(() => toDisplayBlocks(ops, 3), [ops]);
  if (ops.length === 0) return <p className="text-[13px] italic text-fg-subtle">No instructions in either version.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-bg">
      <table className="w-full border-collapse font-mono text-xs leading-5">
        <caption className="sr-only">Line-by-line changes to the instructions</caption>
        <tbody>
          {blocks.map((block, i) =>
            block.kind === "collapsed" ? (
              <CollapsedRows key={i} block={block} />
            ) : (
              <React.Fragment key={i}>
                {block.ops.map((op, j) => (
                  <LineRow key={j} op={op} />
                ))}
              </React.Fragment>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function Value({ change, side }: { change: Extract<FieldDiff, { kind: "scalar" }>; side: "before" | "after" }) {
  const v = side === "before" ? change.before : change.after;
  const text = formatFieldValue(change.section, change.field, v);
  const isDefault = v === null || v === "";
  const mono = change.section === "model_policy" && change.field !== "planning_tier" && !isDefault;
  return (
    <span
      className={cn(
        "inline-flex max-w-full rounded px-1.5 py-0.5 text-[13px]",
        side === "before" ? "bg-danger/10 text-fg-muted line-through decoration-danger/50" : "bg-success/10 text-fg",
        mono && "font-mono text-xs",
        isDefault && "italic",
      )}
    >
      <span className="sr-only">{side === "before" ? "Before: " : "After: "}</span>
      <span className="truncate">{text}</span>
    </span>
  );
}

function ListChange({ change }: { change: Extract<FieldDiff, { kind: "list" }> }) {
  if (change.reordered) {
    return (
      <div className="flex flex-col gap-1 text-[13px]">
        <span className="text-xs text-fg-subtle">Order changed</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs text-fg-muted line-through decoration-danger/50">{change.before.join(" → ")}</span>
          <ArrowRightIcon className="size-3.5 text-fg-subtle" aria-hidden />
          <span className="font-mono text-xs text-fg">{change.after.join(" → ")}</span>
        </div>
      </div>
    );
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {change.removed.map((v) => (
        <li key={`-${v}`} className="inline-flex items-center gap-1 rounded border border-danger/30 bg-danger/10 px-1.5 py-0.5 font-mono text-xs text-fg-muted line-through decoration-danger/50">
          <span aria-hidden className="text-danger no-underline">−</span>
          <span className="sr-only">Removed </span>
          {v}
        </li>
      ))}
      {change.added.map((v) => (
        <li key={`+${v}`} className="inline-flex items-center gap-1 rounded border border-success/30 bg-success/10 px-1.5 py-0.5 font-mono text-xs text-fg">
          <span aria-hidden className="text-success">+</span>
          <span className="sr-only">Added </span>
          {v}
        </li>
      ))}
      {change.after.length === 0 && <li className="text-xs italic text-fg-subtle">now empty</li>}
    </ul>
  );
}

function SectionChanges({ section }: { section: SectionDiff }) {
  return (
    <section aria-label={section.label} className="rounded-lg border border-line bg-surface-1">
      <h4 className="flex items-center justify-between border-b border-line px-3 py-2 text-[13px] font-medium text-fg">
        {section.label}
        <span className="text-2xs font-normal text-fg-subtle">
          {section.changes.length} {section.changes.length === 1 ? "change" : "changes"}
        </span>
      </h4>
      <dl className="divide-y divide-line">
        {section.changes.map((c) => (
          <div key={c.field} className="grid gap-1.5 px-3 py-2.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center">
            <dt className="text-xs text-fg-subtle">{c.label}</dt>
            <dd className="min-w-0">
              {c.kind === "scalar" ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Value change={c} side="before" />
                  <ArrowRightIcon className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                  <Value change={c} side="after" />
                </div>
              ) : (
                <ListChange change={c} />
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Full comparison: summary, instructions line diff, then structured policy/limit changes. */
export function VersionDiffView({
  diff,
  beforeLabel,
  afterLabel,
  sameChecksum,
}: {
  diff: VersionDiff;
  beforeLabel: React.ReactNode;
  afterLabel: React.ReactNode;
  sameChecksum?: boolean;
}) {
  const unchanged = diff.sections.filter((s) => s.changes.length === 0).map((s) => SECTION_LABELS[s.section]);
  if (!diff.instructionsChanged) unchanged.unshift("Instructions");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-[13px]" aria-live="polite">
        <span className="font-mono text-fg">{beforeLabel}</span>
        <ArrowRightIcon className="size-3.5 text-fg-subtle" aria-hidden />
        <span className="font-mono text-fg">{afterLabel}</span>
        <span className="text-fg-subtle">·</span>
        {diff.identical ? (
          <span className="inline-flex items-center gap-1 text-success">
            <CheckCircle2Icon className="size-3.5" aria-hidden /> Identical configuration{sameChecksum ? " (same checksum)" : ""}
          </span>
        ) : (
          <span className="text-fg-muted">
            {diff.changeCount} {diff.changeCount === 1 ? "change" : "changes"}
          </span>
        )}
        {diff.instructionsChanged && (
          <Badge tone="neutral" variant="outline" className="font-mono">
            <span className="text-success">+{diff.instructionStats.added}</span>
            <span className="text-danger">−{diff.instructionStats.removed}</span>
            <span className="sr-only">lines in instructions</span>
          </Badge>
        )}
      </div>

      {diff.instructionsChanged && (
        <section aria-label="Instructions" className="flex flex-col gap-2">
          <h4 className="text-[13px] font-medium text-fg">Instructions</h4>
          <InstructionsDiff ops={diff.instructions} />
        </section>
      )}

      {diff.changedSections.map((s) => (
        <SectionChanges key={s.section} section={s} />
      ))}

      {!diff.identical && unchanged.length > 0 && <p className="text-xs text-fg-subtle">Unchanged: {unchanged.join(", ")}.</p>}
    </div>
  );
}
