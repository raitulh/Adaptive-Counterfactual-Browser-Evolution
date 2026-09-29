/**
 * Display formatting. All functions tolerate null/undefined and invalid input.
 */
import { formatDistanceToNowStrict, intervalToDuration } from "date-fns";

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "3 min ago" / "in 2 h" */
export function relativeTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  const diff = Math.abs(Date.now() - d.getTime());
  if (diff < 10_000) return d.getTime() <= Date.now() ? "just now" : "in a moment";
  return formatDistanceToNowStrict(d, { addSuffix: true });
}

/**
 * Intl formatters in the user's locale, falling back to en-US when the environment reports a locale
 * Intl rejects (e.g. "C"/POSIX in some headless browsers) — formatting must never crash a page.
 */
function safeIntl<T>(make: (locale: string | undefined) => T): T {
  try {
    return make(undefined);
  } catch {
    return make("en-US");
  }
}

const dateTimeFmt = safeIntl((l) => new Intl.DateTimeFormat(l, { dateStyle: "medium", timeStyle: "short" }));
const dateFmt = safeIntl((l) => new Intl.DateTimeFormat(l, { dateStyle: "medium" }));
const timeFmt = safeIntl((l) => new Intl.DateTimeFormat(l, { hour: "2-digit", minute: "2-digit", second: "2-digit" }));

export function dateTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  return d ? dateTimeFmt.format(d) : "—";
}

export function dateOnly(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  return d ? dateFmt.format(d) : "—";
}

export function clockTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  return d ? timeFmt.format(d) : "—";
}

/** Compact duration between two instants (or from `start` until now): "1h 04m", "12.4s". */
export function duration(
  start: string | number | Date | null | undefined,
  end?: string | number | Date | null,
): string {
  const s = toDate(start);
  if (!s) return "—";
  const e = toDate(end ?? null) ?? new Date();
  return durationMs(Math.max(0, e.getTime() - s.getTime()));
}

export function durationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const d = intervalToDuration({ start: 0, end: ms });
  if ((d.days ?? 0) > 0) return `${d.days}d ${d.hours ?? 0}h`;
  if ((d.hours ?? 0) > 0) return `${d.hours}h ${String(d.minutes ?? 0).padStart(2, "0")}m`;
  return `${d.minutes ?? 0}m ${String(d.seconds ?? 0).padStart(2, "0")}s`;
}

export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = value;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

const numberFmt = safeIntl((l) => new Intl.NumberFormat(l));
const compactFmt = safeIntl((l) => new Intl.NumberFormat(l, { notation: "compact", maximumFractionDigits: 1 }));
const usdFmt = safeIntl(
  (l) => new Intl.NumberFormat(l, { style: "currency", currency: "USD", maximumFractionDigits: 2 }),
);
const usdPreciseFmt = safeIntl(
  (l) => new Intl.NumberFormat(l, { style: "currency", currency: "USD", maximumFractionDigits: 4 }),
);

export function number(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : numberFmt.format(value);
}

export function compactNumber(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : compactFmt.format(value);
}

export function percent(fraction: number | null | undefined, digits = 0): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function usd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return (value < 1 ? usdPreciseFmt : usdFmt).format(value);
}

/** "calendar.create_event" → "Calendar · Create event" */
export function humanizeTool(name: string | null | undefined): string {
  if (!name) return "—";
  const [ns, ...rest] = name.split(".");
  const action = rest.join(" ").replace(/_/g, " ");
  const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return action ? `${title(ns)} · ${title(action)}` : title(ns.replace(/_/g, " "));
}

/** "waiting_for_input" → "Waiting for input" */
export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  const s = value.replace(/[_.-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
