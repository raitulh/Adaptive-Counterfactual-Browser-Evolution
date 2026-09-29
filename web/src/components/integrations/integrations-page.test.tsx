import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
const spies = vi.hoisted(() => ({ track: vi.fn(), success: vi.fn(), error: vi.fn(), list: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => "/app/integrations",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/lib/analytics", () => ({ track: spies.track }));
vi.mock("@/lib/auth/hooks", () => ({
  usePermissions: () => ({ can: () => true, canAny: () => true, isLoading: false }),
}));
vi.mock("@/components/ui/toaster", () => ({
  toast: { success: spies.success, error: spies.error, warning: vi.fn(), message: vi.fn() },
  toastError: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, integrationsApi: { ...actual.integrationsApi, list: spies.list } };
});

import { IntegrationsPage } from "./integrations-page";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <IntegrationsPage />
    </QueryClientProvider>,
  );
}

describe("IntegrationsPage OAuth return handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spies.list.mockResolvedValue([]);
  });

  it("confirms a successful connection, tracks it once and cleans the URL", async () => {
    nav.search = "status=connected";
    renderPage();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/app/integrations", { scroll: false }));
    expect(spies.track).toHaveBeenCalledTimes(1);
    expect(spies.track).toHaveBeenCalledWith("integration_connected", { provider: "google" });
    expect(spies.success).toHaveBeenCalledWith("Google connected", expect.anything());
    expect(spies.error).not.toHaveBeenCalled();
  });

  it("explains an error reason, keeps a visible banner and cleans the URL", async () => {
    nav.search = "status=error&reason=access_denied";
    renderPage();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/app/integrations", { scroll: false }));
    expect(spies.error).toHaveBeenCalledWith("Google access was not granted", expect.anything());
    expect(spies.track).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Google access was not granted");
    expect(alert).toHaveTextContent("reason: access_denied");
  });

  it("does nothing special without return parameters and shows the connect empty state", async () => {
    nav.search = "";
    renderPage();
    expect(await screen.findByText("Connect the tools your agents need.")).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
    expect(spies.track).not.toHaveBeenCalled();
  });
});
