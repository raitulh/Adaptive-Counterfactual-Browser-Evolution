import { describe, expect, it } from "vitest";
import {
  cronToSpec,
  cronToWords,
  describeSchedule,
  formatInZone,
  listTimeZones,
  nextRuns,
  normalizeCron,
  specToCron,
  validateCron,
  type ScheduleSpec,
} from "./schedule";

const NOW = new Date("2026-09-29T05:00:00Z"); // a Tuesday

describe("validateCron", () => {
  it("accepts standard 5-field expressions and normalizes whitespace", () => {
    expect(validateCron("  0   8 * *  1-5 ", NOW)).toEqual({ ok: true, expression: "0 8 * * 1-5" });
  });

  it("expands the macros the backend understands", () => {
    expect(normalizeCron("@daily")).toBe("0 0 * * *");
    expect(validateCron("@hourly", NOW)).toEqual({ ok: true, expression: "0 * * * *" });
  });

  it("rejects anything that is not exactly 5 fields", () => {
    expect(validateCron("0 8 * * 1-5 *", NOW)).toMatchObject({ ok: false, error: expect.stringMatching(/5 fields/) });
    expect(validateCron("", NOW)).toMatchObject({ ok: false });
  });

  it("rejects unparseable expressions", () => {
    expect(validateCron("61 8 * * *", NOW)).toMatchObject({ ok: false, error: expect.stringMatching(/valid cron/) });
    expect(validateCron("H 8 * * *", NOW)).toMatchObject({ ok: false, error: expect.stringMatching(/Hashed/) });
  });

  it("enforces the 15-minute minimum interval, including across midnight", () => {
    expect(validateCron("*/5 * * * *", NOW)).toMatchObject({ ok: false, error: expect.stringMatching(/15 minutes/) });
    expect(validateCron("0,10 * * * *", NOW)).toMatchObject({ ok: false });
    expect(validateCron("*/15 * * * *", NOW)).toMatchObject({ ok: true });
    // 23:55 and 00:05 are 10 minutes apart on consecutive days.
    expect(validateCron("55 23 * * *", NOW)).toMatchObject({ ok: true });
    expect(validateCron("5,55 0,23 * * *", NOW)).toMatchObject({ ok: false });
  });

  it("rejects schedules that never match a real date", () => {
    expect(validateCron("0 0 30 2 *", NOW)).toMatchObject({ ok: false, error: expect.stringMatching(/never matches/) });
  });

  it("allows day names", () => {
    expect(validateCron("0 9 * * THU", NOW)).toMatchObject({ ok: true });
  });
});

describe("nextRuns", () => {
  it("evaluates the schedule on the wall clock of the selected time zone", () => {
    const runs = nextRuns("0 8 * * 1-5", "Europe/Berlin", 3, NOW).map((d) => d.toISOString());
    // 08:00 CEST (UTC+2) on Tue, Wed, Thu.
    expect(runs).toEqual(["2026-09-29T06:00:00.000Z", "2026-09-30T06:00:00.000Z", "2026-10-01T06:00:00.000Z"]);
  });

  it("follows DST changes (08:00 stays 08:00 local)", () => {
    const runs = nextRuns("0 8 * * *", "Europe/Berlin", 30, NOW);
    const afterDst = runs.find((d) => d.toISOString().startsWith("2026-10-26"));
    expect(afterDst?.toISOString()).toBe("2026-10-26T07:00:00.000Z"); // CET (UTC+1)
  });

  it("returns nothing for invalid input", () => {
    expect(nextRuns("*/5 * * * *", "UTC", 7, NOW)).toEqual([]);
    expect(nextRuns("0 8 * * *", "Not/AZone", 7, NOW)).toEqual([]);
  });

  it("returns the requested number of runs", () => {
    expect(nextRuns("*/30 * * * *", "UTC", 7, NOW)).toHaveLength(7);
  });
});

describe("schedule presets", () => {
  const cases: [ScheduleSpec, string][] = [
    [{ kind: "interval", every: 30 }, "*/30 * * * *"],
    [{ kind: "hourly", minute: 5 }, "5 * * * *"],
    [{ kind: "daily", hour: 9, minute: 30 }, "30 9 * * *"],
    [{ kind: "weekdays", hour: 8, minute: 0 }, "0 8 * * 1-5"],
    [{ kind: "weekly", days: [1, 5], hour: 17, minute: 0 }, "0 17 * * 1,5"],
    [{ kind: "monthly", day: 1, hour: 9, minute: 0 }, "0 9 1 * *"],
  ];

  it.each(cases)("round-trips %j", (spec, cron) => {
    expect(specToCron(spec)).toBe(cron);
    expect(cronToSpec(cron)).toEqual(spec);
    expect(validateCron(cron, NOW).ok).toBe(true);
  });

  it("treats anything else as custom", () => {
    expect(cronToSpec("0 8 1-7 * 1")).toEqual({ kind: "custom", cron: "0 8 1-7 * 1" });
    expect(cronToSpec("0 8 * 1 *")).toEqual({ kind: "custom", cron: "0 8 * 1 *" });
    expect(cronToSpec("*/45 * * * *")).toEqual({ kind: "custom", cron: "*/45 * * * *" });
  });

  it("maps weekday 7 to Sunday and de-duplicates", () => {
    expect(cronToSpec("0 10 * * 7,0,6")).toEqual({ kind: "weekly", days: [0, 6], hour: 10, minute: 0 });
  });
});

describe("descriptions", () => {
  it("describes presets in plain words", () => {
    expect(describeSchedule("0 8 * * 1-5")).toBe("Every weekday at 08:00");
    expect(describeSchedule("*/15 * * * *")).toBe("Every 15 minutes");
    expect(describeSchedule("0 * * * *")).toBe("Every hour, on the hour");
    expect(describeSchedule("0 17 * * 1,5")).toBe("Every Monday and Friday at 17:00");
    expect(describeSchedule("0 10 * * 0,6")).toBe("Every weekend day at 10:00");
    expect(describeSchedule("0 9 2 * *")).toBe("On the 2nd of every month at 09:00");
  });

  it("falls back to cronstrue for custom expressions", () => {
    expect(describeSchedule("0 8 1-7 * *")).toBe(cronToWords("0 8 1-7 * *"));
    expect(cronToWords("0 8 * * 1-5")).toBe("At 08:00, Monday through Friday");
    expect(cronToWords("nonsense")).toBeNull();
  });

  it("formats instants in a zone", () => {
    expect(formatInZone(new Date("2026-09-29T06:00:00Z"), "Europe/Berlin", "time")).toBe("08:00");
  });

  it("always lists UTC first", () => {
    const zones = listTimeZones();
    expect(zones[0]).toBe("UTC");
    expect(zones.filter((z) => z === "UTC")).toHaveLength(1);
  });
});
