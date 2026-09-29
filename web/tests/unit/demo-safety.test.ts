/** The demo backend must never run outside demo mode, and API mode must never route to it. */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/config/env")>();
  return { env: { ...mod.env, demoMode: false } };
});

import { getTransport } from "@/lib/api/transport";
import { configureDemo, demoFetch, resetDemoBackend } from "@/lib/demo/backend";

describe("demo backend safety", () => {
  it("refuses to answer requests when NEXT_PUBLIC_DEMO_MODE is not true", async () => {
    await expect(demoFetch(new Request("http://localhost:3000/api/v1/users/me"))).rejects.toThrow(
      /NEXT_PUBLIC_DEMO_MODE=true/,
    );
    expect(() => configureDemo({ timeScale: 0.1 })).toThrow();
    expect(() => resetDemoBackend()).toThrow();
  });

  it("API mode uses the network transport (never the demo backend)", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const transport = await getTransport();
    await transport(new Request("http://localhost:3000/api/v1/health"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
