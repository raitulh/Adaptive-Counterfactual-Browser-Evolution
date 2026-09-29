/** Small helpers shared by the demo server and fixtures (no network, no globals beyond crypto). */

let idSource: (() => string) | null = null;
let randomSource: (() => number) | null = null;

export function uuid(): string {
  return idSource ? idSource() : globalThis.crypto.randomUUID();
}

/** Math.random, or a seeded PRNG while seeding (so seeded ids and timelines are reproducible). */
export function random(): number {
  return randomSource ? randomSource() : Math.random();
}

/** Run `fn` with deterministic ids (`seedId(kind, 1..)`) and a deterministic PRNG. */
export function deterministic<T>(kind: number, fn: () => T): T {
  let n = 0;
  let state = 42;
  idSource = () => seedId(kind, ++n);
  randomSource = () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
  try {
    return fn();
  } finally {
    idSource = null;
    randomSource = null;
  }
}

/** Stable, valid (v4-shaped) UUIDs for seeded records so deep links survive a reload. */
export function seedId(kind: number, n: number): string {
  const k = kind.toString(16).padStart(8, "0");
  const tail = n.toString(16).padStart(12, "0");
  return `${k}-de30-4000-8000-${tail}`;
}

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Deep copy for responses: callers can never mutate the store through a returned object. */
export function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** Deterministic 64-hex digest (FNV-1a based). Used where the API shows checksums/hashes. */
export function hash64(input: string): string {
  let out = "";
  for (let round = 0; round < 8; round++) {
    let h = 0x811c9dc5 ^ round;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
  }
  return out;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return hash64(new TextDecoder().decode(data));
}

export function randomToken(prefix: string): string {
  return `${prefix}.${uuid().replace(/-/g, "")}`;
}

/** fnmatch-style glob (only `*` and `?`), as used by tool rules and policies. */
export function globMatch(name: string, pattern: string): boolean {
  const re = new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
  );
  return re.test(name);
}

export function matchesAny(name: string, patterns: readonly string[] | undefined): boolean {
  return (patterns ?? []).some((p) => globMatch(name, p));
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** The visitor's IANA time zone (the demo user "lives" where the visitor is). */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Offset of `timeZone` at instant `ms`, in minutes (e.g. +120 for Europe/Berlin in summer). */
export function tzOffsetMinutes(timeZone: string, ms: number): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(ms));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
  } catch {
    return 0;
  }
}

/** Calendar date (YYYY-MM-DD) in `timeZone`, `dayOffset` days from `ms`. */
export function localDate(timeZone: string, ms: number, dayOffset = 0): string {
  const shifted = ms + tzOffsetMinutes(timeZone, ms) * 60_000 + dayOffset * DAY;
  return new Date(shifted).toISOString().slice(0, 10);
}

/** ISO-8601 with the zone's UTC offset for a local wall-clock time, e.g. 2026-09-30T15:00:00+02:00. */
export function zonedIso(timeZone: string, date: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const guess = Date.parse(`${date}T${hhmm}:00Z`);
  const offset = tzOffsetMinutes(timeZone, guess - tzOffsetMinutes(timeZone, guess) * 60_000);
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return `${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00${off}`;
}
