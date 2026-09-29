/** Scheduled automations with run history (succeeded, failed, a paused one). */
import { CronExpressionParser } from "cron-parser";
import type { AutomationOut, AutomationRunOut } from "@/lib/api";
import type { DemoStore } from "../server/store";
import { DAY, HOUR, iso, MINUTE, seedId } from "../server/util";

export const AUTOMATION_IDS = {
  digest: seedId(0x40, 1),
  weekly: seedId(0x40, 2),
  expenses: seedId(0x40, 3),
};

export function nextRun(cron: string, timeZone: string, from: number): string | null {
  try {
    return CronExpressionParser.parse(cron, { tz: timeZone, currentDate: new Date(from) })
      .next()
      .toISOString();
  } catch {
    return null;
  }
}

export function seedAutomations(store: DemoStore, now: number): void {
  const tz = store.me.timezone;
  const a = (
    id: string,
    name: string,
    cron: string,
    goal: string,
    daysAgo: number,
    extra: Partial<AutomationOut> = {},
  ): AutomationOut => ({
    id,
    name,
    cron_expression: cron,
    timezone: tz,
    trigger_type: "schedule",
    enabled: true,
    disabled_reason: null,
    task_template: { goal, priority: 100 },
    policy: { max_consecutive_failures: 3, pause_on_failure: true },
    retry_policy: { max_attempts: 3, backoff_seconds: 60 },
    max_runs: null,
    run_count: 0,
    consecutive_failures: 0,
    last_run_at: null,
    last_status: null,
    next_run_at: nextRun(cron, tz, now),
    version: 1,
    created_at: iso(now - daysAgo * DAY),
    updated_at: iso(now - daysAgo * DAY),
    ...extra,
  });
  store.automations = [
    a(
      AUTOMATION_IDS.digest,
      "Morning inbox digest",
      "0 8 * * 1-5",
      "Summarize my unread e-mails from the last 24 hours.",
      40,
      { version: 2 },
    ),
    a(
      AUTOMATION_IDS.weekly,
      "Friday calendar review",
      "30 16 * * 5",
      "Check my calendar next week and list meetings without an agenda.",
      25,
    ),
    a(
      AUTOMATION_IDS.expenses,
      "Monthly expense reminder",
      "0 9 1 * *",
      "Draft an email to Finance with last month's expenses.",
      70,
      {
        enabled: false,
        disabled_reason: "Paused after 3 consecutive failures",
        consecutive_failures: 3,
        last_status: "failed",
        next_run_at: null,
      },
    ),
  ];
  const runs: AutomationRunOut[] = [];
  const run = (
    automation: string,
    n: number,
    hoursAgo: number,
    status: string,
    extra: Partial<AutomationRunOut> = {},
  ) => {
    const at = now - hoursAgo * HOUR;
    runs.push({
      id: seedId(0x41, n),
      automation_id: automation,
      scheduled_for: iso(at),
      trigger: "schedule",
      status,
      attempts: 1,
      error: null,
      next_attempt_at: null,
      task_id: null,
      created_at: iso(at),
      finished_at: status === "created" ? null : iso(at + 3 * MINUTE),
      ...extra,
    });
  };
  // Older digest runs (their tasks are outside the demo's retention window).
  for (let i = 0; i < 6; i++) run(AUTOMATION_IDS.digest, 10 + i, (3 + i + Math.floor(i / 5) * 2) * 24, "succeeded");
  run(AUTOMATION_IDS.weekly, 20, 5 * 24, "failed", {
    error: "The external service is temporarily unavailable.",
    attempts: 3,
  });
  run(AUTOMATION_IDS.weekly, 21, 12 * 24, "succeeded");
  run(AUTOMATION_IDS.weekly, 22, 19 * 24, "succeeded");
  for (let i = 0; i < 3; i++)
    run(AUTOMATION_IDS.expenses, 30 + i, (2 + i * 30) * 24, "failed", {
      error: "Blocked: the connected account did not grant Drive access.",
      attempts: 3,
    });
  store.automationRuns = runs;
  for (const auto of store.automations) {
    const mine = runs.filter((r) => r.automation_id === auto.id).sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
    auto.run_count = mine.length;
    auto.last_run_at = mine[0]?.scheduled_for ?? null;
    auto.last_status ??= mine[0]?.status ?? null;
  }
  const weekly = store.automations[1];
  weekly.last_status = "failed";
  weekly.consecutive_failures = 1;
}
