import { describe, expect, it, vi } from "vitest";
import { isApiRequestError } from "@/lib/api/errors";
import { buildActivity, buildEvents, buildOverview } from "@/lib/api/mock/fixtures";
import { MOCK_INVALID_PASSWORD, createMockApi } from "@/lib/api/mock/mock-api";
import {
  verificationResultSchema,
  verificationSessionSchema,
  type ChallengeResponse,
} from "@/lib/schemas/verification";

const fast = {
  createSession: 0,
  perSignal: 0,
  decision: 0,
  networkFailure: 0,
  read: 0,
  write: 0,
  auth: 0,
};
const response: ChallengeResponse = {
  type: "press_hold",
  inputMethod: "pointer",
  holdDurationMs: 1100,
};

async function expectApiError(promise: Promise<unknown>, code: string) {
  const error = await promise.catch((e: unknown) => e);
  expect(isApiRequestError(error)).toBe(true);
  if (isApiRequestError(error)) expect(error.error.code).toBe(code);
}

describe("mock verification adapter", () => {
  it("creates schema-valid, deterministic sessions", async () => {
    const a = createMockApi({ latency: fast });
    const b = createMockApi({ latency: fast });
    const first = await a.verification.createSession({});
    expect(verificationSessionSchema.safeParse(first).success).toBe(true);
    expect((await b.verification.createSession({})).id).toBe(first.id);
  });

  it("success: streams four passing signals then allows", async () => {
    const api = createMockApi({ latency: fast });
    const session = await api.verification.createSession({});
    const onSignal = vi.fn();
    const result = await api.verification.submitChallenge(session.id, response, {
      onSignal,
      scenario: "success",
    });
    expect(verificationResultSchema.safeParse(result).success).toBe(true);
    expect(onSignal).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({ verified: true, decision: "allow", risk: "low", score: 0.93 });
    expect(result.token).toMatch(/^rh_vt_demo_/);
  });

  it("step_up: returns an inconclusive decision without a token", async () => {
    const api = createMockApi({ latency: fast });
    const session = await api.verification.createSession({});
    const result = await api.verification.submitChallenge(session.id, response, {
      scenario: "step_up",
    });
    expect(result).toMatchObject({
      verified: false,
      decision: "step_up",
      risk: "medium",
      token: null,
    });
  });

  it("timeout: emits partial signals then fails with SESSION_EXPIRED", async () => {
    const api = createMockApi({ latency: fast });
    const session = await api.verification.createSession({});
    const onSignal = vi.fn();
    await expectApiError(
      api.verification.submitChallenge(session.id, response, { onSignal, scenario: "timeout" }),
      "SESSION_EXPIRED",
    );
    expect(onSignal).toHaveBeenCalledTimes(2);
  });

  it("network_error: fails with a retryable NETWORK_ERROR", async () => {
    const api = createMockApi({ latency: fast });
    const session = await api.verification.createSession({});
    const error = await api.verification
      .submitChallenge(session.id, response, { scenario: "network_error" })
      .catch((e: unknown) => e);
    expect(isApiRequestError(error) && error.error).toMatchObject({
      code: "NETWORK_ERROR",
      retryable: true,
    });
  });

  it("rejects unknown and expired sessions", async () => {
    let clock = Date.UTC(2026, 0, 1);
    const api = createMockApi({ latency: fast, now: () => clock });
    await expectApiError(api.verification.submitChallenge("sess_missing", response), "NOT_FOUND");
    const session = await api.verification.createSession({});
    clock += 31_000;
    await expectApiError(api.verification.submitChallenge(session.id, response), "SESSION_EXPIRED");
  });

  it("rejects malformed challenge responses", async () => {
    const api = createMockApi({ latency: fast });
    const session = await api.verification.createSession({});
    const invalid = { ...response, holdDurationMs: -1 };
    await expectApiError(api.verification.submitChallenge(session.id, invalid), "VALIDATION_ERROR");
  });

  it("supports cancellation through AbortSignal", async () => {
    const api = createMockApi({ latency: { ...fast, createSession: 1000 } });
    const controller = new AbortController();
    const pending = api.verification.createSession({}, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("mock API keys", () => {
  it("returns the secret once and stores only a masked record", async () => {
    const api = createMockApi({ latency: fast });
    const created = await api.apiKeys.create({ name: "Backend", environment: "live" });
    expect(created.secret).toMatch(/^rh_live_sk_[0-9a-f]{32}$/);
    const listed = await api.apiKeys.list();
    const stored = listed.find((key) => key.id === created.id);
    expect(stored).toBeDefined();
    expect(JSON.stringify(listed)).not.toContain(created.secret);
    expect(stored?.maskedKey).toBe(`rh_live_sk_••••••••${created.secret.slice(-4)}`);
    await api.apiKeys.revoke(created.id);
    expect((await api.apiKeys.list()).some((key) => key.id === created.id)).toBe(false);
  });
});

describe("mock auth", () => {
  it("accepts valid credentials and rejects the documented invalid password", async () => {
    const api = createMockApi({ latency: fast });
    await expect(
      api.auth.login({ email: "a@example.com", password: "whatever" }),
    ).resolves.toMatchObject({ email: "a@example.com" });
    await expectApiError(
      api.auth.login({ email: "a@example.com", password: MOCK_INVALID_PASSWORD }),
      "INVALID_CREDENTIALS",
    );
  });

  it("reports the demo workspace and logs out", async () => {
    const api = createMockApi({ latency: fast });
    await expect(api.auth.me()).resolves.toEqual({
      email: "demo@realhuman.dev",
      workspace: "Demo workspace",
    });
    await expect(api.auth.logout()).resolves.toBeUndefined();
  });
});

describe("sample fixtures", () => {
  it("are deterministic across calls", () => {
    expect(buildActivity()).toEqual(buildActivity());
    expect(buildEvents(5)).toEqual(buildEvents(5));
  });

  it("compute overview metrics from the activity series", () => {
    const overview = buildOverview();
    const current = overview.activity.slice(7);
    expect(overview.sample).toBe(true);
    expect(overview.metrics.verified.value).toBe(current.reduce((sum, d) => sum + d.verified, 0));
    expect(overview.metrics.volume.value).toBe(
      current.reduce((sum, d) => sum + d.verified + d.suspicious + d.blocked, 0),
    );
  });
});
