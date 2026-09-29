"use client";

import { ArrowUpRightIcon, FileTextIcon, GlobeIcon, SearchXIcon, UploadIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Badge, Button, EmptyState, IdChip, Tooltip } from "@/components/ui";
import type { DocumentSearchHit, DocumentSearchResponse } from "@/lib/api";
import { useUiStore } from "@/stores/ui";
import { isSafeHttpUrl, matchedTermCount } from "./highlight";
import { HighlightText } from "./highlight-text";
import { RelevanceMeter } from "./relevance-meter";
import { ResultItem, ResultList } from "./result-list";

function hrefFor(hit: DocumentSearchHit): { href: string; external: boolean } | null {
  if (hit.source_type === "file")
    return { href: `/app/files?file=${encodeURIComponent(hit.source_id)}`, external: false };
  if (hit.url && isSafeHttpUrl(hit.url)) return { href: hit.url, external: true };
  return null;
}

export function DocumentResults({
  data,
  terms,
  onEscape,
}: {
  data: DocumentSearchResponse;
  terms: string[];
  onEscape: () => void;
}) {
  const maxScore = Math.max(...data.results.map((r) => r.score), 0);
  if (data.results.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={<SearchXIcon />}
        title={`No passages match “${data.query}”`}
        description="Document search covers files you've uploaded once their text is extracted. Upload more documents, or try other words."
        action={
          <Button asChild size="sm" variant="secondary">
            <Link href="/app/files">
              <UploadIcon aria-hidden /> Upload documents
            </Link>
          </Button>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-fg-subtle">
        {data.results.length} {data.results.length === 1 ? "passage" : "passages"} ·{" "}
        {data.used_vector_search ? (
          "hybrid ranking (keyword + semantic)"
        ) : (
          <Tooltip content="The semantic index was unavailable for this query, so only keyword matching was used.">
            <span tabIndex={0} className="underline decoration-dotted underline-offset-4 outline-none">
              keyword ranking only
            </span>
          </Tooltip>
        )}
      </p>
      <ResultList label={`Document passages for ${data.query}`} onEscape={onEscape}>
        {data.results.map((hit) => (
          <DocumentResult key={hit.chunk_id} hit={hit} terms={terms} maxScore={maxScore} />
        ))}
      </ResultList>
    </div>
  );
}

function DocumentResult({ hit, terms, maxScore }: { hit: DocumentSearchHit; terms: string[]; maxScore: number }) {
  const router = useRouter();
  const developerMode = useUiStore((s) => s.developerMode);
  const [expanded, setExpanded] = React.useState(false);
  const target = hrefFor(hit);
  const long = hit.content.length > 420;
  const matched = matchedTermCount(hit.content, terms);
  const open = target
    ? () => (target.external ? window.open(target.href, "_blank", "noopener,noreferrer") : router.push(target.href))
    : undefined;
  const Icon = hit.source_type === "web" ? GlobeIcon : FileTextIcon;

  return (
    <ResultItem onOpen={open} label={`${hit.title}, passage ${hit.chunk_index + 1}`}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-fg-subtle"
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 truncate text-[15px] font-medium text-fg">{hit.title}</h3>
            <Badge variant="outline">
              {hit.source_type === "file" ? "File" : hit.source_type === "web" ? "Web page" : hit.source_type}
            </Badge>
            <span className="text-xs text-fg-subtle">Passage {hit.chunk_index + 1}</span>
            {terms.length > 0 && (
              <span className="text-xs text-fg-subtle">
                · {matched}/{terms.length} terms
              </span>
            )}
          </div>
          <blockquote className="relative mt-2 border-l-2 border-accent/30 pl-3">
            <p
              className={
                "text-[13px] leading-relaxed whitespace-pre-line text-fg-muted " +
                (long && !expanded ? "line-clamp-5" : "")
              }
            >
              <HighlightText text={hit.content} terms={terms} />
            </p>
            {long && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 text-xs font-medium text-accent underline-offset-4 hover:underline"
                aria-expanded={expanded}
              >
                {expanded ? "Show less" : "Show the whole passage"}
              </button>
            )}
          </blockquote>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <Tooltip content="Combined rank score (relative bar: compared with the best passage in these results).">
              <span tabIndex={0} className="outline-none">
                <RelevanceMeter
                  value={hit.score}
                  fraction={maxScore > 0 ? hit.score / maxScore : 0}
                  label="Score"
                  digits={3}
                />
              </span>
            </Tooltip>
            {hit.keyword_score !== null && hit.keyword_score !== undefined && (
              <RelevanceMeter value={hit.keyword_score} label="Keyword" digits={3} />
            )}
            {hit.vector_score !== null && hit.vector_score !== undefined && (
              <RelevanceMeter value={hit.vector_score} label="Vector" digits={3} />
            )}
            {developerMode && <IdChip id={hit.document_id} label="doc" />}
            {target && (
              <span className="ml-auto">
                {target.external ? (
                  <a
                    href={target.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-fg-muted hover:text-fg"
                  >
                    Open page <ArrowUpRightIcon className="size-3.5" aria-hidden />
                  </a>
                ) : (
                  <Link
                    href={target.href}
                    className="inline-flex items-center gap-1 font-medium text-fg-muted hover:text-fg"
                  >
                    Open file <ArrowUpRightIcon className="size-3.5" aria-hidden />
                  </Link>
                )}
              </span>
            )}
          </div>
        </div>
      </div>
    </ResultItem>
  );
}
