/**
 * Formatting helpers. All formatters use a fixed locale and UTC so server and
 * client renders are identical (no hydration mismatches).
 */

const LOCALE = "en-US";

const integerFormatter = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const compactFormatter = new Intl.NumberFormat(LOCALE, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "UTC",
});
const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

export function formatInteger(value: number): string {
  return integerFormatter.format(value);
}

export function formatCompact(value: number): string {
  return compactFormatter.format(value);
}

/** 0.934 → "0.93" */
export function formatScore(value: number): string {
  return clamp(value, 0, 1).toFixed(2);
}

/** 12.345 → "+12.3%" */
export function formatDelta(percent: number): string {
  const sign = percent > 0 ? "+" : percent < 0 ? "−" : "";
  return `${sign}${Math.abs(percent).toFixed(1)}%`;
}

export function formatUtcTime(iso: string | number | Date): string {
  return `${timeFormatter.format(new Date(iso))} UTC`;
}

export function formatUtcDate(iso: string | number | Date): string {
  return dateFormatter.format(new Date(iso));
}

export function formatUtcDateTime(iso: string | number | Date): string {
  return `${dateTimeFormatter.format(new Date(iso))} UTC`;
}

/** 1234 → "1.23s", 87 → "87ms" */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Relative offset used in event logs: 0 → "+0ms", 1520 → "+1.52s" */
export function formatOffset(ms: number): string {
  return `+${formatDuration(Math.max(0, ms))}`;
}

/**
 * Shortens an identifier for display: `sess_7f3a9c2e41d8` → `sess_7f3a…41d8`.
 * Identifiers are not secrets, but full values add noise and invite copying.
 */
export function maskId(id: string, visible = 4): string {
  const separator = id.lastIndexOf("_");
  const prefix = separator >= 0 ? id.slice(0, separator + 1) : "";
  const body = separator >= 0 ? id.slice(separator + 1) : id;
  if (body.length <= visible * 2 + 1) return id;
  return `${prefix}${body.slice(0, visible)}…${body.slice(-visible)}`;
}

/**
 * Masks a secret so only its type prefix and last four characters remain:
 * `rh_test_sk_9f8e7d6c5b4a3f2e` → `rh_test_sk_••••••••3f2e`.
 */
export function maskSecret(secret: string, visible = 4): string {
  const match = /^([a-z]+(?:_[a-z]+)*_)/i.exec(secret);
  const prefix = match?.[1] ?? "";
  const body = secret.slice(prefix.length);
  if (body.length <= visible) return `${prefix}${"•".repeat(8)}`;
  return `${prefix}${"•".repeat(8)}${body.slice(-visible)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
