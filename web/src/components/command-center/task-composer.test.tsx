import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentOSApiError } from "@/lib/api/errors";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/auth/hooks", () => ({ usePermissions: () => ({ can: () => true, isLoading: false }) }));

const create = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    tasksApi: {
      ...actual.tasksApi,
      create: (...args: unknown[]) => create(...args),
      list: vi.fn(async () => ({ items: [], has_more: false })),
    },
    agentsApi: { ...actual.agentsApi, list: vi.fn(async () => ({ items: [], has_more: false })) },
  };
});

import { TaskComposer } from "./task-composer";

function renderComposer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipPrimitive.Provider>
        <TaskComposer />
      </TooltipPrimitive.Provider>
    </QueryClientProvider>,
  );
}

const task = (id: string) => ({ task_id: id, status: "created", goal: "g" });
const networkError = () =>
  new AgentOSApiError({ status: 0, code: "network_error", message: "Network request failed." });

describe("TaskComposer submission", () => {
  beforeEach(() => {
    create.mockReset();
    push.mockReset();
  });

  it("reuses the idempotency key when retrying after a network error, and uses a new one after an edit", async () => {
    create
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(task("t-1"));
    renderComposer();
    const box = screen.getByLabelText("What do you want done?");

    fireEvent.change(box, { target: { value: "Plan my week" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/safe and will never create the task twice/)).toBeInTheDocument();

    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    const [body1, key1] = create.mock.calls[0];
    const [, key2] = create.mock.calls[1];
    expect(body1).toEqual({ goal: "Plan my week", priority: 100 });
    expect(key2).toBe(key1);

    // Editing the goal makes it a different submission → a new key.
    await waitFor(() => expect(box).not.toBeDisabled());
    fireEvent.change(box, { target: { value: "Plan my week, mornings only" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(create).toHaveBeenCalledTimes(3));
    const [body3, key3] = create.mock.calls[2];
    expect(body3.goal).toBe("Plan my week, mornings only");
    expect(key3).not.toBe(key1);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/tasks/t-1"));
  });

  it("uses a fresh key for the next submission after success", async () => {
    create.mockResolvedValueOnce(task("t-1")).mockResolvedValueOnce(task("t-2"));
    renderComposer();
    const box = screen.getByLabelText("What do you want done?");
    fireEvent.change(box, { target: { value: "Same goal" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/tasks/t-1"));
    await waitFor(() => expect(box).toHaveValue(""));
    fireEvent.change(box, { target: { value: "Same goal" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][1]).not.toBe(create.mock.calls[0][1]);
  });

  it("keeps Shift+Enter as a newline, and blocks unfilled template placeholders", async () => {
    renderComposer();
    const box = screen.getByLabelText("What do you want done?");
    fireEvent.change(box, { target: { value: "line one" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(create).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Manage email" }));
    expect((box as HTMLTextAreaElement).value).toMatch(/Draft an email to \[person\] about \[subject\]\./);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByText(/Fill in the \[bracketed\] parts/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("opens slash commands and inserts the chosen template", async () => {
    renderComposer();
    const box = screen.getByLabelText("What do you want done?") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "/res", selectionStart: 4 } });
    expect(await screen.findByRole("listbox", { name: "Commands" })).toBeInTheDocument();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box.value).toBe("Research [topic] and summarize the key findings, with sources I can check.");
    expect(create).not.toHaveBeenCalled();
  });
});
