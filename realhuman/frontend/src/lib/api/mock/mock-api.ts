import { createApiError } from "@/lib/api/errors";
import {
  buildEvents,
  buildInitialApiKeys,
  buildOverview,
  buildRequestLogs,
  buildSessions,
} from "@/lib/api/mock/fixtures";
import type { DemoScenario, RealHumanApi } from "@/lib/api/types";
import type { ApiKey, ProjectSettings, WebhookEndpoint } from "@/lib/schemas/dashboard";
import {
  challengeResponseSchema,
  type SignalId,
  type VerificationSession,
  type VerificationSignal,
} from "@/lib/schemas/verification";
import { maskSecret } from "@/lib/utils/format";
import { createSeededRandom, secureHex, seededHex } from "@/lib/utils/random";
import { sleep } from "@/lib/utils/sleep";
import { decide, makeSignal } from "@/lib/verification/scoring";

export interface MockLatency {
  createSession: number;
  perSignal: number;
  decision: number;
  networkFailure: number;
  read: number;
  write: number;
  auth: number;
}

export const DEFAULT_MOCK_LATENCY: MockLatency = {
  createSession: 420,
  perSignal: 360,
  decision: 380,
  networkFailure: 900,
  read: 450,
  write: 520,
  auth: 700,
};

export const MOCK_SESSION_TTL_SECONDS = 30;

/** Password that makes the mock login fail, so error states can be exercised. */
export const MOCK_INVALID_PASSWORD = "incorrect-password";

/** Deterministic signal plans per scenario. Scores are fixed so results are reproducible. */
const SIGNAL_PLANS: Record<"success" | "step_up", readonly [SignalId, number, string][]> = {
  success: [
    ["interaction_pattern", 0.96, "Input timing varied naturally during the hold."],
    ["challenge_response", 0.94, "Challenge completed as issued, within its window."],
    ["session_consistency", 0.92, "Session properties stayed coherent."],
    ["request_behavior", 0.9, "Request cadence matched the configured flow."],
  ],
  step_up: [
    ["interaction_pattern", 0.58, "Input timing was unusually uniform."],
    ["challenge_response", 0.82, "Challenge completed as issued."],
    ["session_consistency", 0.77, "Session properties stayed coherent."],
    ["request_behavior", 0.52, "Requests arrived faster than the flow usually allows."],
  ],
};

export interface MockApiOptions {
  latency?: Partial<MockLatency>;
  /** Clock injection for tests. */
  now?: () => number;
}

/**
 * In-browser implementation of RealHumanApi. Deterministic, never random in
 * user-visible outcomes, and explicitly not a security control.
 */
export function createMockApi(options: MockApiOptions = {}): RealHumanApi {
  const latency: MockLatency = { ...DEFAULT_MOCK_LATENCY, ...options.latency };
  const now = options.now ?? (() => Date.now());
  const sessions = new Map<string, VerificationSession>();
  let sessionCounter = 0;
  let apiKeys: ApiKey[] = buildInitialApiKeys();
  let webhooks: WebhookEndpoint[] = [];
  let settings: ProjectSettings = {
    projectName: "Demo project",
    siteKey: "pk_test_demo_5f2c81a9e04b",
    allowThreshold: 0.8,
    stepUpThreshold: 0.5,
    retentionDays: "7",
  };

  return {
    mode: "mock",

    verification: {
      async createSession(_input, { signal } = {}) {
        await sleep(latency.createSession, signal);
        const random = createSeededRandom(1_000 + sessionCounter);
        sessionCounter += 1;
        const createdAt = now();
        const session: VerificationSession = {
          id: `sess_${seededHex(random, 12)}`,
          status: "challenged",
          challenge: { type: "press_hold", ttlSeconds: MOCK_SESSION_TTL_SECONDS },
          createdAt: new Date(createdAt).toISOString(),
          expiresAt: new Date(createdAt + MOCK_SESSION_TTL_SECONDS * 1000).toISOString(),
        };
        sessions.set(session.id, session);
        return session;
      },

      async submitChallenge(sessionId, response, { signal, onSignal, scenario = "success" } = {}) {
        const session = sessions.get(sessionId);
        if (!session) throw createApiError("NOT_FOUND", { status: 404 });
        if (now() > Date.parse(session.expiresAt)) {
          throw createApiError("SESSION_EXPIRED", { status: 410 });
        }
        if (!challengeResponseSchema.safeParse(response).success) {
          throw createApiError("VALIDATION_ERROR", { status: 422 });
        }
        sessions.set(sessionId, { ...session, status: "analyzing" });

        if (scenario === "network_error") {
          await sleep(latency.networkFailure, signal);
          throw createApiError("NETWORK_ERROR");
        }

        const plan = SIGNAL_PLANS[scenario === "step_up" ? "step_up" : "success"];
        const resolved: VerificationSignal[] = [];
        for (const [index, [id, score, detail]] of plan.entries()) {
          await sleep(latency.perSignal, signal);
          if (scenario === "timeout" && index === 2) {
            sessions.set(sessionId, { ...session, status: "expired" });
            throw createApiError("SESSION_EXPIRED", { status: 410 });
          }
          const resolvedSignal = makeSignal(id, score, detail);
          resolved.push(resolvedSignal);
          onSignal?.(resolvedSignal);
        }

        await sleep(latency.decision, signal);
        const { decision, score, risk } = decide(resolved);
        const verified = decision === "allow";
        const random = createSeededRandom(sessionId.length * 31 + sessionCounter);
        sessions.set(sessionId, { ...session, status: verified ? "completed" : "challenged" });
        return {
          sessionId,
          verified,
          decision,
          risk,
          score,
          token: verified ? `rh_vt_demo_${seededHex(random, 20)}` : null,
          signals: resolved,
          decidedAt: new Date(now()).toISOString(),
        };
      },
    },

    dashboard: {
      async getOverview({ signal } = {}) {
        await sleep(latency.read, signal);
        return buildOverview();
      },
      async listEvents({ limit }, { signal } = {}) {
        await sleep(latency.read, signal);
        return buildEvents(limit);
      },
      async listSessions({ outcome }, { signal } = {}) {
        await sleep(latency.read, signal);
        const all = buildSessions();
        return outcome ? all.filter((session) => session.outcome === outcome) : all;
      },
      async listRequestLogs({ limit }, { signal } = {}) {
        await sleep(latency.read, signal);
        return buildRequestLogs(limit);
      },
    },

    apiKeys: {
      async list({ signal } = {}) {
        await sleep(latency.read, signal);
        return [...apiKeys];
      },
      async create(input, { signal } = {}) {
        await sleep(latency.write, signal);
        // Mock secrets look realistic but are not valid against any API.
        const secret = `rh_${input.environment}_sk_${secureHex(32)}`;
        const key: ApiKey = {
          id: `key_${secureHex(10)}`,
          name: input.name,
          environment: input.environment,
          maskedKey: maskSecret(secret),
          createdAt: new Date(now()).toISOString(),
          lastUsedAt: null,
        };
        apiKeys = [key, ...apiKeys];
        return { ...key, secret };
      },
      async revoke(id, { signal } = {}) {
        await sleep(latency.write, signal);
        if (!apiKeys.some((key) => key.id === id))
          throw createApiError("NOT_FOUND", { status: 404 });
        apiKeys = apiKeys.filter((key) => key.id !== id);
      },
    },

    webhooks: {
      async list({ signal } = {}) {
        await sleep(latency.read, signal);
        return [...webhooks];
      },
      async create(input, { signal } = {}) {
        await sleep(latency.write, signal);
        const endpoint: WebhookEndpoint = {
          id: `wh_${secureHex(10)}`,
          url: input.url,
          events: input.events,
          status: "active",
          createdAt: new Date(now()).toISOString(),
        };
        webhooks = [endpoint, ...webhooks];
        return endpoint;
      },
      async remove(id, { signal } = {}) {
        await sleep(latency.write, signal);
        webhooks = webhooks.filter((endpoint) => endpoint.id !== id);
      },
    },

    settings: {
      async get({ signal } = {}) {
        await sleep(latency.read, signal);
        return { ...settings };
      },
      async update(values, { signal } = {}) {
        await sleep(latency.write, signal);
        settings = { ...settings, ...values };
        return { ...settings };
      },
    },

    auth: {
      async login(credentials, { signal } = {}) {
        await sleep(latency.auth, signal);
        if (credentials.password === MOCK_INVALID_PASSWORD) {
          throw createApiError("INVALID_CREDENTIALS", { status: 401, retryable: false });
        }
        return { email: credentials.email, workspace: "Demo workspace" };
      },
      async signup(credentials, { signal } = {}) {
        await sleep(latency.auth, signal);
        return { email: credentials.email, workspace: "Demo workspace" };
      },
      async me({ signal } = {}) {
        await sleep(latency.read, signal);
        return { email: "demo@realhuman.dev", workspace: "Demo workspace" };
      },
      async logout({ signal } = {}) {
        await sleep(latency.write, signal);
      },
    },

    contact: {
      async requestAccess(_input, { signal } = {}) {
        await sleep(latency.write, signal);
        return { received: true };
      },
    },
  };
}

export type { DemoScenario };
