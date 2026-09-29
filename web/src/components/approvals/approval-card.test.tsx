import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalOut } from "@/lib/api";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const approve = vi.fn();
const reject = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    approvalsApi: {
      ...actual.approvalsApi,
      approve: (...a: unknown[]) => approve(...a),
      reject: (...a: unknown[]) => reject(...a),
    },
  };
});

import { ApprovalCard } from "./approval-card";

function approval(over: Partial<ApprovalOut> = {}): ApprovalOut {
  return {
    id: "ap-1",
    task_id: "t-1",
    step_id: "s-1",
    user_id: "u-1",
    action: "gmail.send",
    tool_name: "gmail.send",
    summary: "Send e-mail “Hello” to rahim@example.org",
    target: "gmail:rahim@example.org",
    arguments_preview: { to: ["rahim@example.org"], subject: "Hello", body: "Hi Rahim" },
    risk_level: "high",
    permission_level: "high_risk_write",
    reasons: ["1 recipient(s) outside the organization"],
    status: "pending",
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    consumed_at: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}

function renderCard(a: ApprovalOut) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipPrimitive.Provider>
        <ApprovalCard approval={a} />
      </TooltipPrimitive.Provider>
    </QueryClientProvider>,
  );
}

describe("ApprovalCard decisions", () => {
  beforeEach(() => {
    approve.mockReset();
    reject.mockReset();
  });

  it("approves low-risk actions directly, and shows 'Approved' only after the backend answers", async () => {
    let resolve!: (v: ApprovalOut) => void;
    approve.mockImplementation(() => new Promise<ApprovalOut>((r) => (resolve = r)));
    renderCard(approval({ risk_level: "low", permission_level: "write" }));
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.queryByText("Approved")).not.toBeInTheDocument();
    resolve(approval({ status: "approved", approved_at: new Date().toISOString() }));
    expect(await screen.findByText("Approved")).toBeInTheDocument();
  });

  it("requires a confirmation dialog that restates the action for high risk", async () => {
    approve.mockResolvedValue(approval({ status: "approved" }));
    renderCard(approval());
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Approve: Send e-mail/)).toBeInTheDocument();
    expect(within(dialog).getByText("gmail.send")).toBeInTheDocument();
    expect(approve).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve and run" }));
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    const [id, key] = approve.mock.calls[0];
    expect(id).toBe("ap-1");
    expect(typeof key).toBe("string");
  });

  it("requires typing the tool name for critical risk", async () => {
    approve.mockResolvedValue(approval({ status: "approved", risk_level: "critical" }));
    renderCard(approval({ risk_level: "critical", tool_name: "payments.transfer", action: "payments.transfer" }));
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Approve and run" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Type/), { target: { value: "payments.transfer" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
  });

  it("requires a reason to reject", async () => {
    reject.mockResolvedValue(approval({ status: "rejected", rejection_reason: "Wrong person" }));
    renderCard(approval());
    fireEvent.click(screen.getByRole("button", { name: /Reject/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject action" }));
    expect(await within(dialog).findByText(/Tell AgentOS why/)).toBeInTheDocument();
    expect(reject).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Wrong person" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject action" }));
    await waitFor(() => expect(reject).toHaveBeenCalledWith("ap-1", expect.any(String), "Wrong person"));
  });

  it("disables decisions once expired", () => {
    renderCard(approval({ expires_at: new Date(Date.now() - 1000).toISOString() }));
    expect(screen.getByRole("button", { name: /Approve/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Reject/ })).toBeDisabled();
    expect(screen.getByText(/Expired — AgentOS will not run this action/)).toBeInTheDocument();
  });
});
