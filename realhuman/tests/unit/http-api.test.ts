import { describe, expect, it, vi } from "vitest";
import { isApiRequestError } from "@/lib/api/errors";
import { createHttpApi } from "@/lib/api/http/http-api";
import type { ChallengeResponse, VerificationResult } from "@/lib/schemas/verification";

const response: ChallengeResponse = {
  type: "press_hold",
  inputMethod: "pointer",
  holdDurationMs: 1100,
};

const validResult: VerificationResult = {
  sessionId: "sess_1",
  verified: true,
  decision: "allow",
  risk: "low",
  score: 0.93,
  token: "rh_vt_x",
  signals: [
    {
      id: "interaction_pattern",
      label: "Interaction pattern",
      status: "pass",
      score: 0.96,
      weight: 0.3,
    },
    {
      id: "challenge_response",
      label: "Challenge response",
      status: "pass",
      score: 0.94,
      weight: 0.3,
    },
  ],
  decidedAt: "2026-09-24T12:00:00.000Z",
};

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

async function errorOf(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e);
  if (!isApiRequestError(error)) throw new Error("expected ApiRequestError");
  return error.error;
}

describe("HTTP adapter", () => {
  it("posts JSON to the configured base URL and replays signals", async () => {
    const fetchMock = vi.fn(async () => json(validResult));
    const api = createHttpApi({ baseUrl: "https://api.example.test/", fetch: fetchMock });
    const onSignal = vi.fn();
    const result = await api.verification.submitChallenge("sess/1", response, { onSignal });

    expect(result).toEqual(validResult);
    expect(onSignal).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://api.example.test/v1/sessions/sess%2F1/challenge");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(String(init.body))).toEqual(response);
  });

  it("serializes query parameters", async () => {
    const fetchMock = vi.fn(async () => json([]));
    const api = createHttpApi({ baseUrl: "https://api.example.test", fetch: fetchMock });
    await api.dashboard.listSessions({ outcome: "blocked" });
    const [url] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(url.searchParams.get("outcome")).toBe("blocked");
  });

  it("rejects responses that do not match the contract", async () => {
    const api = createHttpApi({
      baseUrl: "https://api.example.test",
      fetch: async () => json({ verified: "yes" }),
    });
    expect(await errorOf(api.verification.submitChallenge("s", response))).toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("maps error envelopes and status codes", async () => {
    const envelope = createHttpApi({
      baseUrl: "https://api.example.test",
      fetch: async () =>
        json(
          { error: { code: "RATE_LIMITED", message: "Slow down.", requestId: "req_1" } },
          { status: 429 },
        ),
    });
    expect(await errorOf(envelope.verification.createSession({}))).toEqual({
      code: "RATE_LIMITED",
      message: "Slow down.",
      status: 429,
      retryable: true,
      requestId: "req_1",
    });

    const fastApiDefault = createHttpApi({
      baseUrl: "https://api.example.test",
      fetch: async () => json({ detail: "Session expired" }, { status: 410 }),
    });
    expect(await errorOf(fastApiDefault.verification.createSession({}))).toMatchObject({
      code: "SESSION_EXPIRED",
      retryable: false,
    });
  });

  it("maps network failures", async () => {
    const api = createHttpApi({
      baseUrl: "https://api.example.test",
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(await errorOf(api.dashboard.getOverview())).toMatchObject({
      code: "NETWORK_ERROR",
      retryable: true,
    });
  });

  it("times out slow requests", async () => {
    const api = createHttpApi({
      baseUrl: "https://api.example.test",
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    });
    expect(await errorOf(api.dashboard.getOverview())).toMatchObject({ code: "TIMEOUT" });
  });

  it("reports caller cancellation as ABORTED", async () => {
    const controller = new AbortController();
    const api = createHttpApi({
      baseUrl: "https://api.example.test",
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    });
    const pending = api.dashboard.getOverview({ signal: controller.signal });
    controller.abort();
    expect(await errorOf(pending)).toMatchObject({ code: "ABORTED" });
  });

  it("handles 204 responses for deletes", async () => {
    const api = createHttpApi({
      baseUrl: "https://api.example.test",
      fetch: async () => new Response(null, { status: 204 }),
    });
    await expect(api.apiKeys.revoke("key_1")).resolves.toBeUndefined();
  });
});
