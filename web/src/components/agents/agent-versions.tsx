"use client";

import { ArrowLeftRightIcon, GitCommitVerticalIcon, HistoryIcon } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/controls";
import { CopyButton, IdChip, JsonViewer, RelativeTime } from "@/components/ui/data-display";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, ErrorState } from "@/components/ui/states";
import type { AgentVersionOut } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { useAgentVersions } from "./queries";
import { diffConfigs } from "./version-diff";
import { VersionDiffView } from "./version-diff-view";

export function shortChecksum(checksum: string | null | undefined): string {
  return checksum ? checksum.slice(0, 12) : "—";
}

export function Checksum({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-mono text-2xs text-fg-muted", className)} title={value}>
      <span className="text-fg-subtle">sha256</span>&nbsp;{shortChecksum(value)}
      <CopyButton value={value} label="Copy checksum" className="size-5" />
    </span>
  );
}

export interface ComparePair {
  base: number;
  target: number;
}

function defaultPair(versions: AgentVersionOut[], currentNumber: number | undefined): ComparePair | null {
  if (versions.length < 2) return null;
  const sorted = [...versions].sort((a, b) => b.version_number - a.version_number);
  const target = currentNumber ?? sorted[0].version_number;
  const idx = sorted.findIndex((v) => v.version_number === target);
  const base = sorted[idx + 1]?.version_number ?? sorted[sorted.length - 1].version_number;
  return base === target ? null : { base, target };
}

function VersionSelect({
  label,
  value,
  onChange,
  versions,
  currentNumber,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  versions: AgentVersionOut[];
  currentNumber?: number;
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger aria-label={label} className="h-8 w-auto min-w-28 font-mono text-[13px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {versions.map((v) => (
          <SelectItem key={v.id} value={String(v.version_number)} className="font-mono">
            v{v.version_number}
            {v.version_number === currentNumber ? " · current" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Version history (newest first) and a comparison of any two versions. Versions are immutable:
 * nothing here edits history.
 */
export function AgentVersions({
  agentId,
  currentVersionId,
  pair,
  onPairChange,
}: {
  agentId: string;
  currentVersionId: string | null;
  pair: ComparePair | null;
  onPairChange: (pair: ComparePair | null) => void;
}) {
  const developerMode = useUiStore((s) => s.developerMode);
  const q = useAgentVersions(agentId);
  const versions = React.useMemo(() => [...(q.data ?? [])].sort((a, b) => b.version_number - a.version_number), [q.data]);
  const current = versions.find((v) => v.id === currentVersionId);
  const effective = React.useMemo(() => {
    if (pair && versions.some((v) => v.version_number === pair.base) && versions.some((v) => v.version_number === pair.target)) return pair;
    return defaultPair(versions, current?.version_number);
  }, [pair, versions, current?.version_number]);

  const base = versions.find((v) => v.version_number === effective?.base);
  const target = versions.find((v) => v.version_number === effective?.target);
  const diff = React.useMemo(() => (base && target ? diffConfigs(base, target) : null), [base, target]);

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card className="flex flex-col gap-4 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </Card>
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }
  if (versions.length === 0) {
    return <EmptyState icon={<HistoryIcon />} title="No versions yet" description="Versions appear here once the agent configuration is published." />;
  }

  const select = (v: AgentVersionOut) => {
    const idx = versions.findIndex((x) => x.id === v.id);
    const prev = versions[idx + 1];
    if (prev) onPairChange({ base: prev.version_number, target: v.version_number });
    else if (versions.length > 1) onPairChange({ base: v.version_number, target: versions[0].version_number });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <Card className="self-start p-2">
        <h3 className="px-2 pb-1 pt-2 text-2xs font-medium uppercase tracking-wider text-fg-subtle">History · {versions.length}</h3>
        <ol aria-label="Version history" className="relative">
          {versions.map((v, i) => {
            const isCurrent = v.id === currentVersionId;
            const isBase = v.version_number === effective?.base;
            const isTarget = v.version_number === effective?.target;
            return (
              <li key={v.id} className="relative">
                {i < versions.length - 1 && <span className="absolute bottom-0 left-[1.3rem] top-7 w-px bg-line-strong" aria-hidden />}
                <button
                  type="button"
                  onClick={() => select(v)}
                  aria-current={isTarget ? "true" : undefined}
                  className={cn(
                    "relative flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-accent/50",
                    (isBase || isTarget) && "bg-white/[0.035]",
                  )}
                >
                  <span
                    className={cn(
                      "relative z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border bg-surface-1",
                      isCurrent ? "border-accent/60 text-accent" : "border-line-strong text-fg-subtle",
                    )}
                    aria-hidden
                  >
                    <GitCommitVerticalIcon className="size-3" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[13px] font-medium text-fg">v{v.version_number}</span>
                      {isCurrent && (
                        <Badge tone="accent" className="h-4 px-1.5">
                          current
                        </Badge>
                      )}
                      {isBase && <span className="text-2xs text-danger">base</span>}
                      {isTarget && <span className="text-2xs text-success">compare</span>}
                    </span>
                    <span className="text-xs text-fg-muted">
                      <RelativeTime value={v.created_at} />
                    </span>
                    <span className="font-mono text-2xs text-fg-subtle">sha256 {shortChecksum(v.checksum)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="px-2 pb-2 pt-3 text-2xs leading-relaxed text-fg-subtle">Select a version to compare it with the one before. Versions are immutable.</p>
      </Card>

      <div className="flex min-w-0 flex-col gap-4">
        {versions.length < 2 || !effective || !base || !target || !diff ? (
          <Card>
            <EmptyState
              size="sm"
              icon={<ArrowLeftRightIcon />}
              title="Only one version so far"
              description="Publish a new version to compare configurations. The current version stays unchanged."
            />
          </Card>
        ) : (
          <Card className="flex flex-col gap-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-fg-muted">Compare</span>
              <VersionSelect
                label="Base version"
                value={effective.base}
                onChange={(n) => onPairChange({ base: n, target: effective.target })}
                versions={versions}
                currentNumber={current?.version_number}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Swap versions"
                onClick={() => onPairChange({ base: effective.target, target: effective.base })}
              >
                <ArrowLeftRightIcon />
              </Button>
              <VersionSelect
                label="Compared version"
                value={effective.target}
                onChange={(n) => onPairChange({ base: effective.base, target: n })}
                versions={versions}
                currentNumber={current?.version_number}
              />
              <span className="ml-auto text-xs text-fg-subtle">
                {dateTime(base.created_at)} → {dateTime(target.created_at)}
              </span>
            </div>
            <div className="border-t border-line pt-4">
              <VersionDiffView
                diff={diff}
                beforeLabel={`v${base.version_number}`}
                afterLabel={`v${target.version_number}`}
                sameChecksum={base.checksum === target.checksum}
              />
            </div>
            {developerMode && (
              <div className="grid gap-3 border-t border-line pt-4 xl:grid-cols-2">
                {[base, target].map((v) => (
                  <div key={v.id} className="flex min-w-0 flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-fg">v{v.version_number}</span>
                      <IdChip id={v.id} label="version" />
                    </div>
                    <JsonViewer value={v} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
