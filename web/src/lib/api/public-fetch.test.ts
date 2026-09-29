import { describe, expect, it, vi } from "vitest";
import { getPublicPlans, publicApiBase, publicApiDocsUrl, publicApiOrigin } from "./public-fetch";

const PLAN = {
  name: "free",
  display_name: "Free",
  monthly_quotas: { task_created: 200 },
  features: ["gmail"],
  max_concurrent_tasks: 3,
  max_automations: 3,
  max_members: 1,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("publicApiBase", () => {
  it("defaults to the local API origin", () => {
    expect(publicApiBase({})).toBe("http://localhost:8000/api/v1");
  });
  it("uses AGENTOS_API_ORIGIN when the browser URL is relative", () => {
    expect(publicApiBase({ AGENTOS_API_ORIGIN: "http://api:8000/", NEXT_PUBLIC_API_URL: "/api/v1" })).toBe(
      "http://api:8000/api/v1",
    );
  });
  it("prefers an absolute NEXT_PUBLIC_API_URL", () => {
    const env = { AGENTOS_API_ORIGIN: "http://api:8000", NEXT_PUBLIC_API_URL: "https://api.example.com/api/v1/" };
    expect(publicApiBase(env)).toBe("https://api.example.com/api/v1");
    expect(publicApiOrigin(env)).toBe("https://api.example.com");
  });
});

describe("publicApiDocsUrl", () => {
  it("links the API origin's /docs when the API is public", () => {
    expect(publicApiDocsUrl({ NEXT_PUBLIC_API_URL: "https://api.example.com/api/v1" })).toBe(
      "https://api.example.com/docs",
    );
  });
  it("links local development APIs", () => {
    expect(publicApiDocsUrl({})).toBe("http://localhost:8000/docs");
  });
  it("never publishes an internal upstream address", () => {
    expect(
      publicApiDocsUrl({ AGENTOS_API_ORIGIN: "http://agentos-api.internal:8000", NEXT_PUBLIC_API_URL: "/api/v1" }),
    ).toBeNull();
  });
});

describe("getPublicPlans", () => {
  const env = { AGENTOS_API_ORIGIN: "http://api.test" };

  it("returns typed plans and requests them with ISR caching", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json([PLAN]));
    const result = await getPublicPlans({ fetchImpl, env });
    expect(result).toEqual({ ok: true, data: [PLAN] });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://api.test/api/v1/billing/plans");
    expect(init.next).toEqual({ revalidate: 300 });
    expect(init.headers).not.toHaveProperty("authorization");
  });

  it("reports an unreachable API instead of throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(getPublicPlans({ fetchImpl, env })).resolves.toEqual({ ok: false, reason: "unreachable" });
  });

  it("reports HTTP errors with their status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: { code: "service_unavailable" } }, 503));
    await expect(getPublicPlans({ fetchImpl, env })).resolves.toEqual({ ok: false, reason: "http_error", status: 503 });
  });

  it("rejects malformed bodies", async () => {
    const notJson = vi.fn().mockResolvedValue(new Response("<html>", { status: 200 }));
    await expect(getPublicPlans({ fetchImpl: notJson, env })).resolves.toMatchObject({
      ok: false,
      reason: "invalid_response",
    });
    const wrongShape = vi.fn().mockResolvedValue(json([{ name: "free" }]));
    await expect(getPublicPlans({ fetchImpl: wrongShape, env })).resolves.toMatchObject({
      ok: false,
      reason: "invalid_response",
    });
    const notArray = vi.fn().mockResolvedValue(json({ items: [PLAN] }));
    await expect(getPublicPlans({ fetchImpl: notArray, env })).resolves.toMatchObject({
      ok: false,
      reason: "invalid_response",
    });
  });

  it("times out slow upstreams", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    );
    await expect(
      getPublicPlans({ fetchImpl: fetchImpl as unknown as typeof fetch, env, timeoutMs: 10 }),
    ).resolves.toEqual({
      ok: false,
      reason: "unreachable",
    });
  });
});
