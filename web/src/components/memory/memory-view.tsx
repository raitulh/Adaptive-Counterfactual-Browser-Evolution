"use client";

import { BrainCircuitIcon, LayersIcon, PlusIcon, SearchIcon, SparklesIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Kbd,
  PageContainer,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@/components/ui";
import { memoryTypeValues, type MemoryType } from "@/lib/api";
import { usePermissions } from "@/lib/auth/hooks";
import { cn } from "@/lib/utils";
import { CreateMemoryDialog } from "./create-memory-dialog";
import { useMemoryList, type MemoryStatusFilter } from "./hooks";
import { MemoryCard } from "./memory-card";
import { MemoryField } from "./memory-field";
import { useNow } from "./memory-meters";
import { MemoryRecallResults, MemoryRecallSkeleton } from "./memory-recall";
import { PRIMARY_SECTIONS, SECONDARY_SECTIONS, memoryStatusMeta, metaForType } from "./presentation";

type Section = MemoryType | "all";
const STATUS_OPTIONS: { value: MemoryStatusFilter | "any"; label: string }[] = [
  { value: "any", label: "Any status" },
  { value: "active", label: "Active" },
  { value: "conflicted", label: "Conflicted" },
  { value: "superseded", label: "Superseded" },
];

function parseSection(v: string | null): Section {
  return v && (memoryTypeValues as readonly string[]).includes(v) ? (v as MemoryType) : "all";
}
function parseStatus(v: string | null): MemoryStatusFilter | null {
  return v === "active" || v === "conflicted" || v === "superseded" ? v : null;
}

export function MemoryView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const section = parseSection(params.get("section"));
  const status = parseStatus(params.get("status"));
  const { can } = usePermissions();
  const [createOpen, setCreateOpen] = React.useState(false);
  const now = useNow();

  const setParam = React.useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const list = useMemoryList({ memory_type: section === "all" ? null : section, status });
  const unfiltered = section === "all" && !status;
  const workspaceEmpty = unfiltered && list.isSuccess && list.items.length === 0;

  return (
    <PageContainer width="wide">
      <PageHeader
        eyebrow="Memory OS"
        title="Memory"
        description="What AgentOS knows about you — where it learned each thing, how sure it is, and how fresh it is. Stale or uncertain memories are treated as hints, never as facts."
        actions={
          can("memory:write") ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <PlusIcon aria-hidden /> Remember something
            </Button>
          ) : undefined
        }
      />

      {workspaceEmpty ? (
        <Card className="overflow-hidden">
          <EmptyState
            size="lg"
            visual={<EmptyField />}
            title="AgentOS has not learned this workspace yet."
            description="As you run tasks, AgentOS keeps what's useful — your preferences, contacts and verified facts — each with its source, confidence and freshness. You can also teach it directly."
            action={
              <>
                {can("memory:write") && (
                  <Button variant="primary" onClick={() => setCreateOpen(true)}>
                    <PlusIcon aria-hidden /> Remember something
                  </Button>
                )}
                <Button asChild variant="secondary">
                  <Link href="/app">
                    <SparklesIcon aria-hidden /> Give AgentOS a task
                  </Link>
                </Button>
              </>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
            <RecallPanel section={section} onClearScope={() => setParam("section", null)} />
            <Card className="hidden flex-col gap-2 p-5 lg:flex">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-tight text-fg">Memory field</h2>
                <span className="text-2xs text-fg-subtle">{section === "all" ? "All types" : metaForType(section).section}</span>
              </div>
              <p className="text-xs leading-relaxed text-fg-subtle">
                Fresh memories sit near the core and drift outward as they age. Larger dots matter more; fainter ones are less certain.
              </p>
              {list.isPending ? (
                <Skeleton className="mx-auto mt-2 size-[200px] rounded-full" />
              ) : (
                <MemoryField memories={list.items} now={now} className="mt-1" />
              )}
            </Card>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
            <SectionNav value={section} onChange={(s) => setParam("section", s === "all" ? null : s)} />
            <section aria-labelledby="memory-section-title" className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <h2 id="memory-section-title" className="text-base font-semibold tracking-tight text-fg">
                    {section === "all" ? "All memories" : metaForType(section).section}
                  </h2>
                  <p className="mt-0.5 text-[13px] text-fg-muted">
                    {section === "all" ? "Everything AgentOS remembers, newest first." : metaForType(section).description}
                  </p>
                </div>
                <div className="w-full sm:w-44">
                  <Select value={status ?? "any"} onValueChange={(v) => setParam("status", v === "any" ? null : v)}>
                    <SelectTrigger aria-label="Filter by status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {list.isPending ? (
                <MemoryRecallSkeleton rows={3} />
              ) : list.isError && list.items.length === 0 ? (
                <Card>
                  <ErrorState error={list.error} onRetry={() => void list.refetch()} />
                </Card>
              ) : list.items.length === 0 ? (
                <Card>
                  <SectionEmpty section={section} status={status} onCreate={can("memory:write") ? () => setCreateOpen(true) : undefined} />
                </Card>
              ) : (
                <>
                  <ul className="flex flex-col gap-3" aria-label="Memories">
                    {list.items.map((m) => (
                      <li key={m.id}>
                        <MemoryCard memory={m} now={now} />
                      </li>
                    ))}
                  </ul>
                  {list.hasNextPage && (
                    <div className="flex justify-center">
                      <Button variant="ghost" size="sm" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
                        Load more memories
                      </Button>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </>
      )}

      <CreateMemoryDialog open={createOpen} onOpenChange={setCreateOpen} defaultType={section === "all" ? "long_term" : section} />
    </PageContainer>
  );
}

const RECALL_SUGGESTIONS = ["my meeting preferences", "people I work with", "upcoming deadlines", "how I like emails written"];

function RecallPanel({ section, onClearScope }: { section: Section; onClearScope: () => void }) {
  const [draft, setDraft] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [count, setCount] = React.useState<number | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const types = React.useMemo(() => (section === "all" ? null : [section]), [section]);

  return (
    <Card className="relative overflow-hidden p-5 sm:p-6">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-64 rounded-full bg-accent/[0.06] blur-3xl" />
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setCount(null);
          setQuery(draft.trim());
        }}
        className="relative flex flex-col gap-3"
      >
        <label htmlFor="memory-recall" className="text-lg font-semibold tracking-tight text-fg">
          What do you remember about me?
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <input
              ref={inputRef}
              id="memory-recall"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={500}
              placeholder="Meeting preferences, Rahim's email, what happened with the Q3 report…"
              className="h-11 w-full rounded-lg border border-line-strong bg-bg/60 pl-9 pr-9 text-[15px] text-fg outline-none transition-[border-color,box-shadow] placeholder:text-fg-subtle focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/25"
              autoComplete="off"
            />
            {draft && (
              <button
                type="button"
                onClick={() => {
                  setDraft("");
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-fg-subtle hover:bg-white/5 hover:text-fg"
                aria-label="Clear"
              >
                <XIcon className="size-4" />
              </button>
            )}
          </div>
          <Button type="submit" variant="primary" size="lg" disabled={!draft.trim()} className="h-11">
            Recall
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
          {section !== "all" ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-surface-2 py-0.5 pl-2.5 pr-1 text-fg-muted">
              In {metaForType(section).section.toLowerCase()}
              <button type="button" onClick={onClearScope} className="rounded-full p-0.5 hover:bg-white/10 hover:text-fg" aria-label="Search all memory types">
                <XIcon className="size-3" />
              </button>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <LayersIcon className="size-3.5" aria-hidden /> Searching all memory types
            </span>
          )}
          <span className="hidden sm:inline">
            · Hybrid recall: keyword, meaning, recency and importance · <Kbd>Enter</Kbd>
          </span>
        </div>
      </form>
      <div aria-live="polite" className="sr-only">
        {query && count !== null ? `${count} ${count === 1 ? "memory" : "memories"} recalled` : ""}
      </div>
      {!query && (
        <div className="relative mt-4 flex flex-wrap gap-2" aria-label="Suggestions">
          {RECALL_SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setDraft(s);
                setCount(null);
                setQuery(s);
              }}
              className="rounded-full border border-line bg-surface-2/60 px-3 py-1 text-xs text-fg-muted outline-none transition-colors hover:border-line-strong hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {query && (
        <div className="relative mt-5 border-t border-line pt-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs text-fg-subtle">
              {count === null ? "Recalling…" : `${count} ${count === 1 ? "memory" : "memories"}, best match first`}
            </p>
            <Button variant="ghost" size="xs" onClick={() => { setQuery(""); setDraft(""); }}>
              Clear results
            </Button>
          </div>
          <MemoryRecallResults query={query} memoryTypes={types} onResults={setCount} />
        </div>
      )}
    </Card>
  );
}

function SectionNav({ value, onChange }: { value: Section; onChange: (s: Section) => void }) {
  const item = (s: Section) => {
    const meta = s === "all" ? { section: "All memories", icon: BrainCircuitIcon } : metaForType(s);
    const Icon = meta.icon;
    const active = value === s;
    return (
      <button
        key={s}
        type="button"
        onClick={() => onChange(s)}
        aria-pressed={active}
        className={cn(
          "inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 lg:w-full",
          active ? "bg-surface-3 text-fg shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]" : "text-fg-muted hover:bg-white/[0.04] hover:text-fg",
        )}
      >
        <Icon className={cn("size-4", active ? "text-accent" : "text-fg-subtle")} aria-hidden />
        {meta.section}
      </button>
    );
  };
  return (
    <nav aria-label="Memory sections" className="-mx-4 min-w-0 px-4 lg:mx-0 lg:px-0">
      <div className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {item("all")}
        {PRIMARY_SECTIONS.map(item)}
        <span className="hidden px-3 pb-1 pt-4 text-2xs font-medium uppercase tracking-wider text-fg-subtle lg:block">Short-lived</span>
        {SECONDARY_SECTIONS.map(item)}
      </div>
    </nav>
  );
}

function SectionEmpty({ section, status, onCreate }: { section: Section; status: MemoryStatusFilter | null; onCreate?: () => void }) {
  if (status && status !== "active") {
    return (
      <EmptyState
        size="sm"
        icon={<LayersIcon />}
        title={`No ${memoryStatusMeta[status].label.toLowerCase()} memories`}
        description={memoryStatusMeta[status].description}
      />
    );
  }
  const meta = section === "all" ? null : metaForType(section);
  const Icon = meta?.icon ?? BrainCircuitIcon;
  return (
    <EmptyState
      size="sm"
      icon={<Icon />}
      title={meta ? `No ${meta.section.toLowerCase()} yet` : "No memories match these filters"}
      description={meta ? `${meta.description} AgentOS adds these as it works, or you can add one yourself.` : undefined}
      action={
        onCreate ? (
          <Button size="sm" variant="secondary" onClick={onCreate}>
            <PlusIcon aria-hidden /> Remember {meta ? `a ${meta.label.toLowerCase()}` : "something"}
          </Button>
        ) : undefined
      }
    />
  );
}

/** Empty-state visual: the field's guide rings with a faint core, nothing learned yet. */
function EmptyField() {
  return (
    <svg viewBox="0 0 160 160" className="size-36" aria-hidden>
      <defs>
        <radialGradient id="empty-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgb(92 225 230 / 0.28)" />
          <stop offset="100%" stopColor="rgb(92 225 230 / 0)" />
        </radialGradient>
      </defs>
      {[24, 44, 64].map((r, i) => (
        <circle key={r} cx={80} cy={80} r={r} fill="none" className="stroke-white/[0.08]" strokeDasharray={i === 2 ? "2 5" : undefined} />
      ))}
      <circle cx={80} cy={80} r={26} fill="url(#empty-core)" />
      <circle cx={80} cy={80} r={3} className="fill-accent motion-safe:animate-pulse" />
    </svg>
  );
}
