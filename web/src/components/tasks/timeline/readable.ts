/**
 * Backend summaries embed machine timestamps ("…from 2026-09-30T16:00:00+00:00 to …"). For display,
 * ISO-8601 date-times inside free text are replaced with the user's local, readable form.
 * Display only — the underlying data is never changed.
 */
import { dateTime } from "@/lib/format";

const ISO_IN_TEXT = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?(?![\d:])/g;

export function readable<T extends string | null | undefined>(text: T): T {
  if (!text) return text;
  return text.replace(ISO_IN_TEXT, (match) => {
    const d = new Date(match);
    return Number.isNaN(d.getTime()) ? match : dateTime(d);
  }) as T;
}
