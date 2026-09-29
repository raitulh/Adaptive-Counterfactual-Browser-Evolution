"use client";

import { BrainCircuitIcon, FileTextIcon, GlobeIcon, LockIcon, SearchIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Button, Kbd, PageContainer, PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { track } from "@/lib/analytics";
import { usePermissions } from "@/lib/auth/hooks";
import { cn } from "@/lib/utils";
import { MemoryRecallResults } from "../memory/memory-recall";
import { DocumentResults } from "./document-results";
import { queryTerms } from "./highlight";
import { useDocumentSearch, useWebSearch } from "./hooks";
import { ResultList, focusFirstResult } from "./result-list";
import { SearchErrorPanel, type SearchTab } from "./search-error";
import { WebResults } from "./web-results";

const TABS: { id: SearchTab; label: string; icon: typeof GlobeIcon; permission: "search:use" | "files:read" | "memory:read" }[] = [
  { id: "web", label: "Web", icon: GlobeIcon, permission: "search:use" },
  { id: "documents", label: "Documents", icon: FileTextIcon, permission: "files:read" },
  { id: "memory", label: "Memory", icon: BrainCircuitIcon, permission: "memory:read" },
];

const MAX_QUERY = 400;

function parseTab(v: string | null): SearchTab {
  return v === "documents" || v === "memory" ? v : "web";
}

export function SearchView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = (params.get("q") ?? "").trim().slice(0, MAX_QUERY);
  const tab = parseTab(params.get("tab"));
  const { can, isLoading: permsLoading } = usePermissions();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const resultsRef = React.useRef<HTMLDivElement>(null);
  const terms = React.useMemo(() => queryTerms(q), [q]);

  const navigate = React.useCallback(
    (next: { q?: string; tab?: SearchTab }, mode: "push" | "replace") => {
      const sp = new URLSearchParams(params.toString());
      if (next.q !== undefined) {
        if (next.q) sp.set("q", next.q);
        else sp.delete("q");
      }
      if (next.tab !== undefined) {
        if (next.tab === "web") sp.delete("tab");
        else sp.set("tab", next.tab);
      }
      const qs = sp.toString();
      router[mode](qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const web = useWebSearch(q, tab === "web");
  const docs = useDocumentSearch(q, tab === "documents");
  const [memoryResult, setMemoryResult] = React.useState<{ q: string; count: number } | null>(null);
  const memoryCount = memoryResult?.q === q ? memoryResult.count : undefined;
  const onMemoryResults = React.useCallback((count: number) => setMemoryResult({ q, count }), [q]);

  // "/" focuses the search box from anywhere on the page.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Privacy-safe analytics: which surface and how many results — never the query.
  const webCount = web.data?.results.length;
  const docCount = docs.data?.results.length;
  React.useEffect(() => {
    if (webCount !== undefined) track("search_performed", { tab: "web", result_count: webCount });
  }, [webCount, web.dataUpdatedAt]);
  React.useEffect(() => {
    if (docCount !== undefined) track("search_performed", { tab: "documents", result_count: docCount });
  }, [docCount, docs.dataUpdatedAt]);
  React.useEffect(() => {
    if (memoryCount !== undefined) track("search_performed", { tab: "memory", result_count: memoryCount });
  }, [memoryCount]);

  const counts: Record<SearchTab, number | undefined> = {
    web: webCount,
    documents: docCount,
    memory: memoryCount,
  };
  const activeCount = counts[tab];
  const focusInput = () => inputRef.current?.focus();
  const switchTab = (t: SearchTab) => navigate({ tab: t }, "replace");

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Research"
        title="Search"
        description="Research across the web, the documents you've uploaded and what AgentOS remembers — with sources you can cite."
      />

      <SearchBox
        key={q}
        initial={q}
        inputRef={inputRef}
        onSubmit={(value) => navigate({ q: value }, value === q ? "replace" : "push")}
        onArrowDown={() => focusFirstResult(resultsRef.current)}
      />

      <Tabs value={tab} onValueChange={(v) => switchTab(v as SearchTab)} className="mt-6">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList aria-label="Search in">
            {TABS.map((t) => {
              const Icon = t.icon;
              const locked = !permsLoading && !can(t.permission);
              return (
                <TabsTrigger key={t.id} value={t.id} className="gap-2">
                  <Icon aria-hidden />
                  {t.label}
                  {locked ? (
                    <LockIcon className="text-fg-subtle" aria-label="No access" />
                  ) : counts[t.id] !== undefined && q ? (
                    <span className="rounded-full bg-white/[0.07] px-1.5 text-2xs tabular-nums text-fg-muted">{counts[t.id]}</span>
                  ) : null}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        <div role="status" aria-live="polite" className="sr-only">
          {q && activeCount !== undefined ? `${activeCount} ${activeCount === 1 ? "result" : "results"} for ${q}` : ""}
        </div>

        <div ref={resultsRef}>
          <TabsContent value="web">
            {!q ? (
              <TabIntro tab="web" onPick={(v) => navigate({ q: v }, "push")} />
            ) : web.isPending ? (
              <ResultsSkeleton />
            ) : web.isError ? (
              <Panel>
                <SearchErrorPanel
                  error={web.error}
                  tab="web"
                  failedAt={web.errorUpdatedAt}
                  onSwitchTab={switchTab}
                  onRetry={() => void web.refetch()}
                />
              </Panel>
            ) : (
              <WebResults data={web.data} terms={terms} onEscape={focusInput} />
            )}
          </TabsContent>

          <TabsContent value="documents">
            {!q ? (
              <TabIntro tab="documents" onPick={(v) => navigate({ q: v }, "push")} />
            ) : docs.isPending ? (
              <ResultsSkeleton />
            ) : docs.isError ? (
              <Panel>
                <SearchErrorPanel
                  error={docs.error}
                  tab="documents"
                  failedAt={docs.errorUpdatedAt}
                  onSwitchTab={switchTab}
                  onRetry={() => void docs.refetch()}
                />
              </Panel>
            ) : (
              <DocumentResults data={docs.data} terms={terms} onEscape={focusInput} />
            )}
          </TabsContent>

          <TabsContent value="memory">
            {!q ? (
              <TabIntro tab="memory" onPick={(v) => navigate({ q: v }, "push")} />
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-fg-subtle">
                  Hybrid recall over your memories — keyword, meaning, recency and importance.{" "}
                  <Link href="/app/memory" className="text-fg-muted underline-offset-4 hover:text-fg hover:underline">
                    Open Memory OS
                  </Link>
                </p>
                <MemoryTabResults query={q} onResults={onMemoryResults} onEscape={focusInput} />
              </div>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </PageContainer>
  );
}

function MemoryTabResults({ query, onResults, onEscape }: { query: string; onResults: (n: number) => void; onEscape: () => void }) {
  return (
    <ResultList as="div" label={`Memories recalled for ${query}`} onEscape={onEscape}>
      <MemoryRecallResults
        query={query}
        limit={20}
        onResults={onResults}
        renderItem={(node, i) => (
          <div data-result tabIndex={0} aria-label={`Memory ${i + 1}`} className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            {node}
          </div>
        )}
      />
    </ResultList>
  );
}

function SearchBox({
  initial,
  inputRef,
  onSubmit,
  onArrowDown,
}: {
  initial: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: (q: string) => void;
  onArrowDown: () => void;
}) {
  const [draft, setDraft] = React.useState(initial);
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const value = draft.trim();
        if (value) onSubmit(value.slice(0, MAX_QUERY));
      }}
      className="relative"
    >
      <label htmlFor="search-query" className="sr-only">
        Search
      </label>
      <div className="group relative flex items-center rounded-2xl border border-line-strong bg-surface-1 shadow-panel transition-[border-color,box-shadow] focus-within:border-accent/50 focus-within:ring-4 focus-within:ring-accent/10">
        <SearchIcon className="pointer-events-none absolute left-4 size-5 text-fg-subtle group-focus-within:text-accent" aria-hidden />
        <input
          ref={inputRef}
          id="search-query"
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              onArrowDown();
            }
          }}
          maxLength={MAX_QUERY}
          autoFocus={!initial}
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Search the web, your documents and memory…"
          className="h-14 w-full min-w-0 bg-transparent pl-12 pr-28 text-base text-fg outline-none placeholder:text-fg-subtle [&::-webkit-search-cancel-button]:hidden"
        />
        <div className="absolute right-2 flex items-center gap-1.5">
          {draft && (
            <button
              type="button"
              onClick={() => {
                setDraft("");
                inputRef.current?.focus();
              }}
              className="rounded-md p-1.5 text-fg-subtle hover:bg-white/5 hover:text-fg"
              aria-label="Clear search"
            >
              <XIcon className="size-4" />
            </button>
          )}
          <Button type="submit" variant="primary" size="sm" disabled={!draft.trim()}>
            Search
          </Button>
        </div>
      </div>
      <p className="mt-2 hidden items-center gap-3 text-xs text-fg-subtle sm:flex">
        <span className="inline-flex items-center gap-1">
          <Kbd>/</Kbd> focus
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>Enter</Kbd> search
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>↓</Kbd>
          <Kbd>↑</Kbd> move through results
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>Esc</Kbd> back to the box
        </span>
      </p>
    </form>
  );
}

const INTROS: Record<SearchTab, { title: string; body: React.ReactNode; examples: string[] }> = {
  web: {
    title: "Search the open web",
    body: "Results are ranked, de-duplicated and cited. Copy a citation straight into your work.",
    examples: ["latest EU AI Act guidance", "postgres keyset pagination", "how to write a board update"],
  },
  documents: {
    title: "Search inside your documents",
    body: (
      <>
        Finds passages in files you&apos;ve{" "}
        <Link href="/app/files" className="text-fg-muted underline underline-offset-4 hover:text-fg">
          uploaded
        </Link>{" "}
        once their text is extracted, ranked by keywords and meaning.
      </>
    ),
    examples: ["budget review", "launch date", "contract renewal terms"],
  },
  memory: {
    title: "Ask what AgentOS remembers",
    body: "Recall preferences, contacts, facts and past outcomes — each with its confidence and freshness.",
    examples: ["meeting preferences", "Rahim's email", "what happened last week"],
  },
};

function TabIntro({ tab, onPick }: { tab: SearchTab; onPick: (q: string) => void }) {
  const intro = INTROS[tab];
  const Icon = TABS.find((t) => t.id === tab)!.icon;
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-line-strong px-6 py-14 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl border border-line-strong bg-surface-2 text-fg-muted">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="max-w-md">
        <h2 className="text-base font-semibold tracking-tight text-fg">{intro.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{intro.body}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2" aria-label="Example searches">
        {intro.examples.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onPick(ex)}
            className="rounded-full border border-line bg-surface-1 px-3 py-1 text-xs text-fg-muted outline-none transition-colors hover:border-line-strong hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-line bg-surface-1", className)}>{children}</div>;
}

function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Searching">
      <Skeleton className="h-3 w-48" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex gap-3 rounded-xl border border-line bg-surface-1 p-5">
          <Skeleton className="size-8 shrink-0 rounded-lg" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}

