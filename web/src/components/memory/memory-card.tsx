"use client";

import { ArrowUpRightIcon, KeyRoundIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Badge, Button, ConfirmDialog, IdChip, RelativeTime, Tooltip, toast, toastError } from "@/components/ui";
import type { MemoryOut, RetrievedMemory } from "@/lib/api";
import { usePermissions } from "@/lib/auth/hooks";
import { dateTime } from "@/lib/format";
import { toneClasses } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { useDeleteMemory, useVerifyMemory } from "./hooks";
import { ConfidenceMeter, FreshnessMeter, ImportanceMeter, ScoreMeter } from "./memory-meters";
import { describeSource, metaForType, presentMemory } from "./presentation";
import { HighlightText } from "../search/highlight-text";

/** The fields shared by a listed memory (MemoryOut) and a recalled one (RetrievedMemory). */
export type MemoryLike = Pick<
  RetrievedMemory,
  "id" | "content" | "memory_type" | "confidence" | "importance" | "freshness" | "source_type" | "source_reference" | "last_verified_at"
> & {
  subject_key?: string | null;
  status?: string;
  score?: number;
} & Partial<Pick<MemoryOut, "created_at" | "access_count" | "last_accessed_at" | "expires_at" | "superseded_by">>;

export function MemoryCard({
  memory,
  now,
  terms,
  as: Comp = "article",
}: {
  memory: MemoryLike;
  now: number;
  /** Query terms to highlight (recall results). */
  terms?: string[];
  as?: "article" | "li";
}) {
  const p = presentMemory(memory);
  const type = metaForType(memory.memory_type);
  const TypeIcon = type.icon;
  const source = describeSource(memory.source_type, memory.source_reference);
  const developerMode = useUiStore((s) => s.developerMode);

  return (
    <Comp
      className={cn(
        "group/memory relative flex flex-col gap-4 rounded-xl border bg-surface-1 p-4 transition-[opacity,border-color,background-color] duration-200 sm:p-5",
        p.uncertain
          ? "border-dashed border-line-strong bg-surface-1/50 opacity-80 hover:opacity-100 focus-within:opacity-100"
          : "border-line hover:border-line-strong",
      )}
      aria-label={`${type.label} memory${p.tags.length ? ` (${p.tags.map((t) => t.label).join(", ")})` : ""}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted">
          <TypeIcon className="size-3.5 text-fg-subtle" aria-hidden />
          {type.label}
        </span>
        {memory.subject_key && (
          <Tooltip content="Subject key — memories with the same key are checked for conflicts.">
            <span tabIndex={0} className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-1.5 font-mono text-2xs text-fg-subtle outline-none">
              <KeyRoundIcon className="size-3" aria-hidden />
              {memory.subject_key}
            </span>
          </Tooltip>
        )}
        {p.tags.map((t) => (
          <Tooltip key={t.label} content={t.description}>
            <Badge tone={t.tone} variant="outline" className="border-dashed" tabIndex={0}>
              {t.label}
            </Badge>
          </Tooltip>
        ))}
        <span className="ml-auto flex items-center gap-1">
          <MemoryActions memory={memory} canVerify={p.canVerify} />
        </span>
      </header>

      <p className={cn("text-[15px] leading-relaxed text-pretty", p.uncertain ? "text-fg-muted" : "text-fg")}>
        {terms && terms.length ? <HighlightText text={memory.content} terms={terms} /> : memory.content}
      </p>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <ConfidenceMeter value={memory.confidence} />
        <ImportanceMeter value={memory.importance} />
        <FreshnessMeter memoryType={memory.memory_type} lastVerifiedAt={memory.last_verified_at} freshness={p.freshness} now={now} />
        {memory.score !== undefined && <ScoreMeter value={memory.score} />}
      </div>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-3 text-xs text-fg-subtle">
        <span className="inline-flex items-center gap-1">
          {source.href ? (
            <Link href={source.href} className="inline-flex items-center gap-0.5 text-fg-muted underline-offset-4 hover:text-fg hover:underline">
              {source.label}
              <ArrowUpRightIcon className="size-3" aria-hidden />
            </Link>
          ) : (
            <span className="text-fg-muted">{source.label}</span>
          )}
        </span>
        <span className="inline-flex items-center gap-1">
          <ShieldCheckIcon className={cn("size-3", toneClasses.verify.text)} aria-hidden />
          Verified <RelativeTime value={memory.last_verified_at} className="text-fg-muted" />
        </span>
        {memory.created_at && (
          <span>
            Learned <RelativeTime value={memory.created_at} className="text-fg-muted" />
          </span>
        )}
        {memory.access_count !== undefined && memory.access_count > 0 && (
          <Tooltip content={memory.last_accessed_at ? `Last recalled ${dateTime(memory.last_accessed_at)}` : undefined}>
            <span tabIndex={0} className="outline-none">
              Recalled {memory.access_count}×
            </span>
          </Tooltip>
        )}
        {memory.expires_at && (
          <span>
            Expires <RelativeTime value={memory.expires_at} className="text-fg-muted" />
          </span>
        )}
        {developerMode && <IdChip id={memory.id} label="mem" className="ml-auto" />}
      </footer>
    </Comp>
  );
}

function MemoryActions({ memory, canVerify }: { memory: MemoryLike; canVerify: boolean }) {
  const { can } = usePermissions();
  const verify = useVerifyMemory();
  const remove = useDeleteMemory();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  if (!can("memory:write")) return null;
  const excerpt = memory.content.length > 120 ? `${memory.content.slice(0, 117)}…` : memory.content;

  return (
    <>
      {canVerify && (
        <Tooltip content="Confirm this is still true. Marks it fresh and trusted, and resolves a conflict in its favour.">
          <Button
            size="xs"
            variant="ghost"
            className="text-verify hover:bg-verify/10 hover:text-verify"
            loading={verify.isPending}
            onClick={() =>
              verify.mutate(memory.id, {
                onSuccess: () => toast.success("Memory verified", { description: "It's marked fresh and trusted." }),
                onError: (err) => toastError(err, "Couldn't verify this memory"),
              })
            }
          >
            <ShieldCheckIcon aria-hidden />
            Verify
          </Button>
        </Tooltip>
      )}
      <Button
        size="icon-xs"
        variant="ghost"
        className="text-fg-subtle hover:bg-danger/10 hover:text-danger"
        aria-label="Delete memory"
        onClick={() => setConfirmOpen(true)}
      >
        <Trash2Icon />
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="danger"
        title="Delete this memory permanently?"
        description="AgentOS will forget it and remove everything derived from it (its search embedding and source links). Agents stop using it immediately. This can't be undone."
        confirmLabel="Delete memory"
        confirmText="delete"
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(memory.id, {
            onSuccess: () => {
              setConfirmOpen(false);
              toast.success("Memory deleted");
            },
            onError: (err) => toastError(err, "Couldn't delete this memory"),
          })
        }
      >
        <blockquote className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-[13px] leading-relaxed text-fg-muted">
          {excerpt}
        </blockquote>
      </ConfirmDialog>
    </>
  );
}
