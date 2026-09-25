import type {
  ActivityPoint,
  ApiKey,
  EventOutcome,
  Overview,
  RequestLog,
  SessionRecord,
  VerificationEvent,
} from "@/lib/schemas/dashboard";
import type { RiskLevel } from "@/lib/schemas/verification";
import { createSeededRandom, seededHex } from "@/lib/utils/random";
import { roundScore } from "@/lib/verification/scoring";

/**
 * Deterministic sample data. A fixed reference time keeps server and client
 * renders identical and screenshots stable. All of it is labeled "sample"
 * wherever it is displayed.
 */
export const SAMPLE_REFERENCE_TIME = Date.UTC(2026, 8, 24, 12, 0, 0);
const DAY_MS = 86_400_000;

const ORIGINS = [
  "app.example.com",
  "checkout.example.com",
  "api.example.com",
  "community.example.org",
] as const;
const ACTIONS = ["signup", "login", "checkout", "create_api_key", "post_comment"] as const;

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length) % items.length]!;
}

export function buildActivity(days = 14): ActivityPoint[] {
  const random = createSeededRandom(20260924);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(SAMPLE_REFERENCE_TIME - (days - 1 - index) * DAY_MS);
    date.setUTCHours(0, 0, 0, 0);
    const weekday = date.getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const trend = 1 + index * 0.017;
    const verified = Math.round((weekend ? 1680 : 2310) * trend * (0.93 + random() * 0.14));
    // A burst of automated signups mid-period makes the sample realistic.
    const burst = index === 8 ? 3.1 : index === 9 ? 1.7 : 1;
    const suspicious = Math.round(verified * (0.055 + random() * 0.03) * burst);
    const blocked = Math.round(verified * (0.017 + random() * 0.012) * burst);
    return { date: date.toISOString(), verified, suspicious, blocked };
  });
}

function sum(points: readonly ActivityPoint[], key: "verified" | "suspicious" | "blocked") {
  return points.reduce((total, point) => total + point[key], 0);
}

function percentChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function buildOverview(): Overview {
  const activity = buildActivity(14);
  const current = activity.slice(7);
  const previous = activity.slice(0, 7);
  const metric = (key: "verified" | "suspicious" | "blocked") => ({
    value: sum(current, key),
    delta: percentChange(sum(current, key), sum(previous, key)),
  });
  const volumeNow = sum(current, "verified") + sum(current, "suspicious") + sum(current, "blocked");
  const volumeBefore =
    sum(previous, "verified") + sum(previous, "suspicious") + sum(previous, "blocked");
  return {
    rangeDays: 7,
    sample: true,
    metrics: {
      volume: { value: volumeNow, delta: percentChange(volumeNow, volumeBefore) },
      verified: metric("verified"),
      suspicious: metric("suspicious"),
      blocked: metric("blocked"),
    },
    activity,
  };
}

function outcomeFor(random: () => number): EventOutcome {
  const roll = random();
  if (roll < 0.72) return "verified";
  if (roll < 0.86) return "step_up";
  if (roll < 0.95) return "blocked";
  return "expired";
}

function scoreFor(outcome: EventOutcome, random: () => number): number {
  switch (outcome) {
    case "verified":
      return roundScore(0.82 + random() * 0.16);
    case "step_up":
      return roundScore(0.52 + random() * 0.26);
    case "blocked":
      return roundScore(0.08 + random() * 0.36);
    case "expired":
      return roundScore(0.3 + random() * 0.3);
  }
}

function riskFor(outcome: EventOutcome): RiskLevel {
  if (outcome === "verified") return "low";
  if (outcome === "blocked") return "high";
  return "medium";
}

export function buildEvents(count = 12): VerificationEvent[] {
  const random = createSeededRandom(4242);
  let offset = 0;
  return Array.from({ length: count }, () => {
    offset += Math.round(8_000 + random() * 70_000);
    const outcome = outcomeFor(random);
    return {
      id: `evt_${seededHex(random, 12)}`,
      sessionId: `sess_${seededHex(random, 12)}`,
      outcome,
      risk: riskFor(outcome),
      score: scoreFor(outcome, random),
      origin: pick(ORIGINS, random),
      action: pick(ACTIONS, random),
      at: new Date(SAMPLE_REFERENCE_TIME - offset).toISOString(),
    };
  });
}

export function buildSessions(count = 28): SessionRecord[] {
  const random = createSeededRandom(7331);
  let offset = 0;
  return Array.from({ length: count }, () => {
    offset += Math.round(20_000 + random() * 240_000);
    const outcome = outcomeFor(random);
    return {
      id: `sess_${seededHex(random, 12)}`,
      outcome,
      risk: riskFor(outcome),
      score: scoreFor(outcome, random),
      challenge:
        outcome === "verified" && random() < 0.35
          ? "none"
          : random() < 0.8
            ? "press_hold"
            : "single_step",
      origin: pick(ORIGINS, random),
      startedAt: new Date(SAMPLE_REFERENCE_TIME - offset).toISOString(),
      durationMs: Math.round(outcome === "expired" ? 120_000 : 900 + random() * 5_200),
    };
  });
}

const LOG_ROUTES: readonly { method: RequestLog["method"]; path: string; status: number }[] = [
  { method: "POST", path: "/v1/sessions", status: 201 },
  { method: "POST", path: "/v1/sessions/{id}/challenge", status: 200 },
  { method: "POST", path: "/v1/verify", status: 200 },
  { method: "POST", path: "/v1/verify", status: 200 },
  { method: "GET", path: "/v1/dashboard/overview", status: 200 },
  { method: "POST", path: "/v1/verify", status: 410 },
  { method: "POST", path: "/v1/sessions", status: 429 },
  { method: "POST", path: "/v1/sessions/{id}/challenge", status: 422 },
];

export function buildRequestLogs(count = 30): RequestLog[] {
  const random = createSeededRandom(9001);
  let offset = 0;
  return Array.from({ length: count }, (_, index) => {
    offset += Math.round(1_500 + random() * 20_000);
    // Mostly successful traffic with occasional client errors.
    const route = random() < 0.82 ? LOG_ROUTES[index % 5]! : pick(LOG_ROUTES.slice(5), random);
    return {
      id: `req_${seededHex(random, 14)}`,
      method: route.method,
      path: route.path,
      status: route.status,
      latencyMs: Math.round(route.status >= 400 ? 18 + random() * 30 : 34 + random() * 140),
      at: new Date(SAMPLE_REFERENCE_TIME - offset).toISOString(),
    };
  });
}

export function buildInitialApiKeys(): ApiKey[] {
  return [
    {
      id: "key_local_dev",
      name: "Local development",
      environment: "test",
      maskedKey: "rh_test_sk_••••••••7c1d",
      createdAt: new Date(SAMPLE_REFERENCE_TIME - 9 * DAY_MS).toISOString(),
      lastUsedAt: new Date(SAMPLE_REFERENCE_TIME - 42 * 60_000).toISOString(),
    },
  ];
}
