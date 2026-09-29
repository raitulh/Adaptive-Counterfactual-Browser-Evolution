"use client";

import { CheckIcon, GlobeIcon, LinkIcon, QuoteIcon, SearchXIcon } from "lucide-react";
import * as React from "react";
import { Badge, Button, EmptyState, RelativeTime, Tooltip } from "@/components/ui";
import type { WebSearchHit, WebSearchResponse } from "@/lib/api";
import { dateOnly } from "@/lib/format";
import { cn } from "@/lib/utils";
import { domainOf, formatCitation, formatMarkdownCitation, isSafeHttpUrl, pathOf } from "./highlight";
import { HighlightText } from "./highlight-text";
import { RelevanceMeter } from "./relevance-meter";
import { ResultItem, ResultList } from "./result-list";

export function WebResults({ data, terms, onEscape }: { data: WebSearchResponse; terms: string[]; onEscape: () => void }) {
  if (data.results.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={<SearchXIcon />}
        title={`No web results for “${data.query}”`}
        description="Try fewer or broader words, or check the spelling."
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-fg-subtle">
        {data.results.length} results via <span className="font-medium text-fg-muted">{data.provider}</span> · ranked and
        de-duplicated · retrieved <RelativeTime value={data.retrieved_at} />
      </p>
      <ResultList label={`Web results for ${data.query}`} onEscape={onEscape}>
        {data.results.map((hit) => (
          <WebResult key={`${hit.rank}-${hit.url}`} hit={hit} terms={terms} />
        ))}
      </ResultList>
    </div>
  );
}

function WebResult({ hit, terms }: { hit: WebSearchHit; terms: string[] }) {
  const safe = isSafeHttpUrl(hit.url);
  const open = () => {
    if (safe) window.open(hit.url, "_blank", "noopener,noreferrer");
  };
  return (
    <ResultItem onOpen={safe ? open : undefined} label={`Result ${hit.rank}: ${hit.title}`}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-fg-subtle"
        >
          <GlobeIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-fg-subtle">
            <span className="truncate font-medium text-fg-muted">{domainOf(hit.url)}</span>
            <span className="hidden truncate sm:inline">{pathOf(hit.url)}</span>
          </div>
          <h3 className="mt-0.5 text-[15px] font-medium leading-snug text-fg">
            {safe ? (
              <a
                href={hit.url}
                target="_blank"
                rel="noopener noreferrer"
                tabIndex={-1}
                className="decoration-accent/50 underline-offset-4 outline-none hover:text-accent hover:underline"
              >
                <HighlightText text={hit.title} terms={terms} />
              </a>
            ) : (
              <HighlightText text={hit.title} terms={terms} />
            )}
          </h3>
          {hit.snippet && (
            <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
              <HighlightText text={hit.snippet} terms={terms} />
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-fg-subtle">
            <RelevanceMeter value={hit.relevance} label="Relevance" />
            <Badge variant="outline" className="font-mono">
              {hit.provider} #{hit.provider_rank}
            </Badge>
            {hit.published_at && <span>Published {dateOnly(hit.published_at)}</span>}
            <span>
              Retrieved <RelativeTime value={hit.retrieved_at} />
            </span>
            <span className="ml-auto flex items-center gap-1">
              <CopyAction value={formatCitation(hit.citation)} label="Copy citation" icon={<QuoteIcon />} />
              <CopyAction value={formatMarkdownCitation(hit.citation)} label="Copy as Markdown link" icon={<LinkIcon />} />
            </span>
          </div>
        </div>
      </div>
    </ResultItem>
  );
}

function CopyAction({ value, label, icon }: { value: string; label: string; icon: React.ReactNode }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Tooltip content={copied ? "Copied" : label}>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label={copied ? "Copied" : label}
        className={cn(copied && "text-success")}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          } catch {
            /* clipboard unavailable */
          }
        }}
      >
        {copied ? <CheckIcon /> : icon}
      </Button>
    </Tooltip>
  );
}
