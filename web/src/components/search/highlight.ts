/**
 * Query-term highlighting and small formatting helpers for search results. Pure functions; the
 * `<Highlight>` component renders the segments as <mark>.
 */
import type { Citation } from "@/lib/api";

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "do",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "the",
  "to",
  "was",
  "what",
  "when",
  "where",
  "who",
  "with",
  "you",
  "your",
  "about",
]);

/**
 * Terms to highlight: quoted phrases stay whole, `-excluded` terms and stopwords are dropped,
 * punctuation is trimmed, case-insensitive duplicates removed. Longest first so phrases win.
 */
export function queryTerms(query: string): string[] {
  const out = new Map<string, string>();
  const re = /(-?)"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query ?? "")) !== null) {
    if (m[2] !== undefined) {
      if (m[1] === "-") continue;
      const phrase = m[2].trim().replace(/\s+/g, " ");
      if (phrase.length >= 2 && !out.has(phrase.toLowerCase())) out.set(phrase.toLowerCase(), phrase);
      continue;
    }
    const raw = m[3];
    if (raw.startsWith("-")) continue;
    const term = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (term.length < 2 || STOPWORDS.has(term.toLowerCase())) continue;
    if (!out.has(term.toLowerCase())) out.set(term.toLowerCase(), term);
  }
  return [...out.values()].sort((a, b) => b.length - a.length);
}

export interface Segment {
  text: string;
  match: boolean;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Split `text` into matched / unmatched segments (case-insensitive, adjacent matches merged). */
export function highlightSegments(text: string, terms: string[]): Segment[] {
  if (!text) return [];
  const usable = terms.filter((t) => t.trim().length > 0);
  if (usable.length === 0) return [{ text, match: false }];
  const re = new RegExp(usable.map((t) => escapeRegExp(t).replace(/\s+/g, "\\s+")).join("|"), "giu");
  const segments: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (m[0].length === 0) continue;
    if (start > last) segments.push({ text: text.slice(last, start), match: false });
    const prev = segments[segments.length - 1];
    if (prev?.match && start === last) prev.text += m[0];
    else segments.push({ text: m[0], match: true });
    last = start + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), match: false });
  return segments;
}

/** How many distinct terms occur in the text. */
export function matchedTermCount(text: string, terms: string[]): number {
  const lower = (text ?? "").toLowerCase();
  return terms.filter((t) => lower.includes(t.toLowerCase())).length;
}

/** "https://www.example.com/a/b" → "example.com" */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Readable path after the domain, trimmed: "/docs/getting-started" */
export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    const path = decodeURI(u.pathname).replace(/\/$/, "");
    return path.length > 60 ? `${path.slice(0, 57)}…` : path;
  } catch {
    return "";
  }
}

/** Only http(s) links are rendered as clickable (never javascript:, data:, …). */
export function isSafeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Plain-text citation: Title. URL (via provider, retrieved YYYY-MM-DD). */
export function formatCitation(c: Pick<Citation, "title" | "source_url" | "provider" | "retrieved_at">): string {
  const retrieved = (c.retrieved_at ?? "").slice(0, 10);
  const title = c.title?.trim() || domainOf(c.source_url);
  return `${title}. ${c.source_url} (via ${c.provider}${retrieved ? `, retrieved ${retrieved}` : ""})`;
}

/** Markdown citation link. */
export function formatMarkdownCitation(c: Pick<Citation, "title" | "source_url">): string {
  const title = (c.title?.trim() || domainOf(c.source_url)).replace(/[[\]]/g, "");
  return `[${title}](${c.source_url})`;
}
