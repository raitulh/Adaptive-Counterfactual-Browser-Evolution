/**
 * Schedule helpers for the automation builder: cron validation (mirroring the backend rules in
 * app/automations/schemas.py), a small preset "schedule spec" ↔ cron mapping, human-readable
 * descriptions and a timezone-aware preview of upcoming runs.
 *
 * The backend is authoritative: it re-validates every expression and computes `next_run_at`.
 * These helpers only give immediate, honest feedback while editing.
 */
import { CronExpressionParser } from "cron-parser";
import cronstrue from "cronstrue";

/** Backend `MIN_INTERVAL_MINUTES`: schedules may run at most every 15 minutes. */
export const MIN_INTERVAL_MINUTES = 15;

/** Backend `_MACROS` (croniter-compatible aliases, normalized before validation). */
const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

export function normalizeCron(expression: string): string {
  const expr = (expression ?? "").trim().split(/\s+/).filter(Boolean).join(" ");
  return MACROS[expr.toLowerCase()] ?? expr;
}

export type CronValidation = { ok: true; expression: string } | { ok: false; error: string };

function numericValues(values: readonly (number | string)[]): number[] {
  return values.filter((v): v is number => typeof v === "number");
}

/**
 * Validate a 5-field cron expression like the backend does: exactly five fields, parseable,
 * never more often than every 15 minutes (minute × hour grid, wrapping across midnight), and at
 * least one real future occurrence.
 */
export function validateCron(input: string, now: Date = new Date()): CronValidation {
  const expression = normalizeCron(input);
  if (!expression) return { ok: false, error: "Enter a cron expression." };
  const fields = expression.split(" ");
  if (fields.length !== 5) {
    return { ok: false, error: "Use exactly 5 fields: minute, hour, day of month, month, day of week." };
  }
  // Hashed values ("H") are a Jenkins extension the scheduler does not understand.
  if (/[hH]/.test(expression.replace(/[a-zA-Z]{3}/g, ""))) {
    return { ok: false, error: "Hashed values (H) are not supported." };
  }
  let parsed: ReturnType<typeof CronExpressionParser.parse>;
  try {
    parsed = CronExpressionParser.parse(expression, { tz: "UTC", currentDate: now });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/day of month/i.test(message)) return { ok: false, error: "This schedule never matches a real date." };
    return { ok: false, error: "This isn't a valid cron expression." };
  }
  const minutes = numericValues(parsed.fields.minute.values);
  const hours = numericValues(parsed.fields.hour.values);
  const times = hours.flatMap((h) => minutes.map((m) => h * 60 + m)).sort((a, b) => a - b);
  if (times.length === 0) return { ok: false, error: "This isn't a valid cron expression." };
  let minGap = times[0] + 24 * 60 - times[times.length - 1];
  for (let i = 1; i < times.length; i++) minGap = Math.min(minGap, times[i] - times[i - 1]);
  if (minGap < MIN_INTERVAL_MINUTES) {
    return { ok: false, error: `Schedules may run at most every ${MIN_INTERVAL_MINUTES} minutes.` };
  }
  try {
    parsed.next();
  } catch {
    return { ok: false, error: "This schedule has no future occurrence." };
  }
  return { ok: true, expression };
}

/** Next `count` occurrences after `from`, evaluated on the wall clock of `timezone`. */
export function nextRuns(expression: string, timezone: string, count = 7, from: Date = new Date()): Date[] {
  const valid = validateCron(expression, from);
  if (!valid.ok || !isValidTimeZone(timezone)) return [];
  try {
    return CronExpressionParser.parse(valid.expression, { tz: timezone, currentDate: from })
      .take(count)
      .map((d) => d.toDate());
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------- presets

export type IntervalMinutes = 15 | 20 | 30;
export const INTERVAL_CHOICES: IntervalMinutes[] = [15, 20, 30];

export type ScheduleSpec =
  | { kind: "interval"; every: IntervalMinutes }
  | { kind: "hourly"; minute: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekdays"; hour: number; minute: number }
  | { kind: "weekly"; days: number[]; hour: number; minute: number }
  | { kind: "monthly"; day: number; hour: number; minute: number }
  | { kind: "custom"; cron: string };

export type ScheduleKind = ScheduleSpec["kind"];

export const SCHEDULE_KINDS: { kind: ScheduleKind; label: string }[] = [
  { kind: "weekdays", label: "Every weekday" },
  { kind: "daily", label: "Every day" },
  { kind: "weekly", label: "Weekly" },
  { kind: "monthly", label: "Monthly" },
  { kind: "hourly", label: "Every hour" },
  { kind: "interval", label: "Every few minutes" },
  { kind: "custom", label: "Custom (cron)" },
];

export const WEEKDAYS = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 0, short: "Sun", long: "Sunday" },
] as const;

const pad = (n: number) => String(n).padStart(2, "0");
export const clock = (hour: number, minute: number) => `${pad(hour)}:${pad(minute)}`;

export function specToCron(spec: ScheduleSpec): string {
  switch (spec.kind) {
    case "interval":
      return `*/${spec.every} * * * *`;
    case "hourly":
      return `${spec.minute} * * * *`;
    case "daily":
      return `${spec.minute} ${spec.hour} * * *`;
    case "weekdays":
      return `${spec.minute} ${spec.hour} * * 1-5`;
    case "weekly": {
      const days = [...new Set(spec.days)].sort((a, b) => a - b);
      return `${spec.minute} ${spec.hour} * * ${days.length ? days.join(",") : "1"}`;
    }
    case "monthly":
      return `${spec.minute} ${spec.hour} ${spec.day} * *`;
    case "custom":
      return normalizeCron(spec.cron);
  }
}

const INT = /^\d{1,2}$/;
const inRange = (v: string, lo: number, hi: number) => INT.test(v) && Number(v) >= lo && Number(v) <= hi;

/** Recognize the simple shapes the preset editor produces; anything else is `custom`. */
export function cronToSpec(expression: string): ScheduleSpec {
  const expr = normalizeCron(expression);
  const parts = expr.split(" ");
  if (parts.length !== 5) return { kind: "custom", cron: expr };
  const [mi, h, dom, mon, dow] = parts;
  const interval = /^\*\/(\d+)$/.exec(mi);
  if (interval && h === "*" && dom === "*" && mon === "*" && dow === "*") {
    const every = Number(interval[1]);
    if (every === 15 || every === 20 || every === 30) return { kind: "interval", every };
  }
  if (!inRange(mi, 0, 59) || mon !== "*") return { kind: "custom", cron: expr };
  const minute = Number(mi);
  if (h === "*" && dom === "*" && dow === "*") return { kind: "hourly", minute };
  if (!inRange(h, 0, 23)) return { kind: "custom", cron: expr };
  const hour = Number(h);
  if (dom === "*" && dow === "*") return { kind: "daily", hour, minute };
  if (dom === "*" && dow === "1-5") return { kind: "weekdays", hour, minute };
  if (dom === "*" && /^[0-7](,[0-7])*$/.test(dow)) {
    const days = [...new Set(dow.split(",").map((d) => Number(d) % 7))].sort((a, b) => a - b);
    return { kind: "weekly", days, hour, minute };
  }
  if (dow === "*" && inRange(dom, 1, 31)) return { kind: "monthly", day: Number(dom), hour, minute };
  return { kind: "custom", cron: expr };
}

export function defaultSpec(kind: ScheduleKind, previous?: ScheduleSpec): ScheduleSpec {
  const hour = previous && "hour" in previous ? previous.hour : 8;
  const minute = previous && "minute" in previous ? previous.minute : 0;
  switch (kind) {
    case "interval":
      return { kind, every: 30 };
    case "hourly":
      return { kind, minute: 0 };
    case "daily":
    case "weekdays":
      return { kind, hour, minute };
    case "weekly":
      return { kind, days: [1], hour, minute };
    case "monthly":
      return { kind, day: 1, hour, minute };
    case "custom":
      return { kind, cron: previous ? specToCron(previous) : "0 8 * * 1-5" };
  }
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** cronstrue description ("At 08:00, Monday through Friday") or null when it can't describe it. */
export function cronToWords(expression: string): string | null {
  try {
    return cronstrue.toString(normalizeCron(expression), {
      use24HourTimeFormat: true,
      throwExceptionOnParseError: true,
      verbose: false,
    });
  } catch {
    return null;
  }
}

/** Short, friendly schedule sentence: "Every weekday at 08:00"; falls back to cronstrue. */
export function describeSchedule(expression: string): string {
  const spec = cronToSpec(expression);
  switch (spec.kind) {
    case "interval":
      return `Every ${spec.every} minutes`;
    case "hourly":
      return spec.minute === 0 ? "Every hour, on the hour" : `Every hour at :${pad(spec.minute)}`;
    case "daily":
      return `Every day at ${clock(spec.hour, spec.minute)}`;
    case "weekdays":
      return `Every weekday at ${clock(spec.hour, spec.minute)}`;
    case "weekly": {
      const names = WEEKDAYS.filter((d) => spec.days.includes(d.value)).map((d) => d.long);
      if (spec.days.length === 2 && spec.days.includes(0) && spec.days.includes(6)) {
        return `Every weekend day at ${clock(spec.hour, spec.minute)}`;
      }
      return `Every ${listJoin(names)} at ${clock(spec.hour, spec.minute)}`;
    }
    case "monthly":
      return `On the ${ordinal(spec.day)} of every month at ${clock(spec.hour, spec.minute)}`;
    case "custom":
      return cronToWords(spec.cron) ?? spec.cron;
  }
}

// ---------------------------------------------------------------------------- time zones

const FALLBACK_ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Istanbul",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export function isValidTimeZone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** IANA zones supported by this browser (UTC first), or a safe curated list. */
export function listTimeZones(): string[] {
  let zones: string[] = [];
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    zones = supported ? supported("timeZone") : [];
  } catch {
    zones = [];
  }
  if (zones.length === 0) zones = FALLBACK_ZONES;
  return ["UTC", ...zones.filter((z) => z !== "UTC")];
}

export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidTimeZone(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

/** Current UTC offset label for a zone, e.g. "GMT+2" (best effort). */
export function zoneOffsetLabel(zone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? "";
  } catch {
    return "";
  }
}

function formatter(zone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone: zone });
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: isValidTimeZone(zone) ? zone : "UTC" });
  }
}

/** "Mon, Oct 5 · 08:00" in the given zone. */
export function formatInZone(date: Date, zone: string, style: "full" | "time" | "day" = "full"): string {
  if (style === "time") return formatter(zone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  if (style === "day") return formatter(zone, { weekday: "short", month: "short", day: "numeric" }).format(date);
  return `${formatter(zone, { weekday: "short", month: "short", day: "numeric" }).format(date)} · ${formatter(zone, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date)}`;
}
