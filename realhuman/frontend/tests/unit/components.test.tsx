import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render as renderUi, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HoldButton } from "@/components/demo/hold-button";
import { CopyButton } from "@/components/ui/copy-button";
import { CodeBlock } from "@/components/ui/code-block";
import type * as ApiModule from "@/lib/api";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof ApiModule>();
  const { createMockApi } = await import("@/lib/api/mock/mock-api");
  const api = createMockApi({ latency: { auth: 5 } });
  return { ...original, getApi: () => api };
});

// Imported after mocks are registered.
const { LoginForm } = await import("@/components/auth/login-form");

/** Renders inside the providers the app shell supplies. */
function render(ui: ReactElement) {
  return renderUi(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

describe("LoginForm", () => {
  beforeEach(() => push.mockReset());

  it("shows accessible validation errors on submit", async () => {
    const user = userEvent.setup();
    render(<LoginForm mode="signin" />);
    await user.click(screen.getByRole("button", { name: /log in/i }));
    const email = screen.getByLabelText("Email");
    expect(await screen.findByText("Enter your email address.")).toBeInTheDocument();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email.getAttribute("aria-describedby")).toContain("email-error");
  });

  it("signs in and redirects to the dashboard", async () => {
    const user = userEvent.setup();
    render(<LoginForm mode="signin" />);
    await user.type(screen.getByLabelText("Email"), "dev@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: /log in/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
  });

  it("surfaces invalid credentials and re-enables the form", async () => {
    const user = userEvent.setup();
    render(<LoginForm mode="signin" />);
    await user.type(screen.getByLabelText("Email"), "dev@example.com");
    await user.type(screen.getByLabelText("Password"), "incorrect-password");
    await user.click(screen.getByRole("button", { name: /log in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/didn't work/i);
    expect(screen.getByRole("button", { name: /log in/i })).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });

  it("toggles password visibility accessibly", async () => {
    const user = userEvent.setup();
    render(<LoginForm mode="signin" />);
    const password = screen.getByLabelText("Password");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(password).toHaveAttribute("type", "password");
    await user.click(toggle);
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("requires a 12-character password when signing up", async () => {
    const user = userEvent.setup();
    render(<LoginForm mode="signup" />);
    await user.type(screen.getByLabelText("Email"), "dev@example.com");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(await screen.findByText("Use at least 12 characters.")).toBeInTheDocument();
  });
});

describe("CopyButton", () => {
  it("copies the value and confirms", async () => {
    const user = userEvent.setup();
    // user-event installs its own clipboard stub in setup(); replace it afterwards.
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CopyButton value="npm i" label="Copy install command" />);
    await user.click(screen.getByRole("button", { name: "Copy install command" }));
    expect(writeText).toHaveBeenCalledWith("npm i");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(screen.getByText("Copied to clipboard")).toBeInTheDocument();
  });
});

describe("HoldButton", () => {
  it("completes when Space is held long enough", async () => {
    const onComplete = vi.fn();
    render(<HoldButton onComplete={onComplete} />);
    const button = screen.getByRole("button", { name: "Press and hold to verify" });
    act(() => button.focus());
    fireEvent.keyDown(button, { key: " " });
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(onComplete.mock.calls[0]?.[0]).toMatchObject({ inputMethod: "keyboard" });
  });

  it("resets when released early", async () => {
    const onComplete = vi.fn();
    render(<HoldButton onComplete={onComplete} />);
    const button = screen.getByRole("button", { name: "Press and hold to verify" });
    fireEvent.keyDown(button, { key: "Enter" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    fireEvent.keyUp(button, { key: "Enter" });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe("CodeBlock", () => {
  it("renders every line and marks the active one", () => {
    const { container } = render(
      <CodeBlock code={"a\nb\nc"} language="ts" label="Example" activeLine={1} />,
    );
    expect(screen.getByLabelText("Example")).toBeInTheDocument();
    const lines = container.querySelectorAll("code > span");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toHaveAttribute("data-active");
    expect(lines[0]).not.toHaveAttribute("data-active");
  });
});
