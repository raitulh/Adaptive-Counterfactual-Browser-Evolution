import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TaskDetailView } from "@/lib/api";
import type { TaskActions } from "./hooks";
import { isConnectionBlock, RecoveryPanel } from "./recovery-panel";
import { MEETING_STEPS } from "./timeline/fixtures";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));

function mutation() {
  return { mutate: vi.fn(), isPending: false, error: null } as unknown as TaskActions["resume"];
}

function actions(): TaskActions {
  return { cancel: mutation(), pause: mutation(), resume: mutation(), provideInput: mutation() as never, confirmStep: mutation() as never };
}

function task(over: Partial<TaskDetailView>): TaskDetailView {
  return {
    task_id: "t-1",
    goal: "Schedule a meeting",
    status: "running",
    progress: 0.5,
    agent_id: null,
    agent_version_id: null,
    priority: 100,
    plan_version: 1,
    pending_questions: null,
    failure_code: null,
    failure_message: null,
    result_summary: null,
    tool_calls: 3,
    model_calls: 1,
    created_at: "2026-09-29T05:00:00Z",
    updated_at: "2026-09-29T05:01:00Z",
    started_at: "2026-09-29T05:00:01Z",
    completed_at: null,
    plan: null,
    steps: MEETING_STEPS,
    verifications: [],
    reproducibility: {},
    ...over,
  };
}

describe("RecoveryPanel", () => {
  it("explains an unverified action with Expected / Observed / Difference and confirms the outcome", async () => {
    const a = actions();
    const step = { ...MEETING_STEPS[2], status: "requires_reconciliation" as const, verification_status: "failed" as const, error_message: "The event could not be read back." };
    render(
      <RecoveryPanel
        task={task({
          status: "requires_reconciliation",
          steps: [MEETING_STEPS[0], MEETING_STEPS[1], step, MEETING_STEPS[3]],
          verifications: [
            {
              id: "v1",
              step_id: step.id,
              scope: "step",
              status: "failed",
              method: "read_back",
              expected: { start: "2026-09-30T15:00:00+00:00", summary: "Meeting with Rahim" },
              observed: { start: "2026-09-30T16:00:00+00:00", summary: "Meeting with Rahim" },
              differences: [{ field: "start", expected: "2026-09-30T15:00:00+00:00", observed: "2026-09-30T16:00:00+00:00" }],
              evidence: {},
              verified_at: "2026-09-29T05:01:00Z",
            },
          ],
        })}
        actions={a}
        entries={[]}
      />,
    );
    expect(screen.getByText("AgentOS could not fully verify the external result")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Expected" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "Start" }).closest("tr")).toHaveTextContent("Differs");
    expect(within(table).getByRole("rowheader", { name: "Summary" }).closest("tr")).toHaveTextContent("Matches");

    fireEvent.click(screen.getByRole("button", { name: /It did not happen/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/it will happen twice/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Run it again" }));
    await waitFor(() =>
      expect(a.confirmStep.mutate).toHaveBeenCalledWith({ stepId: step.id, body: { outcome: "did_not_happen", note: null } }, expect.anything()),
    );
  });

  it("links to integrations when blocked by a missing connection", () => {
    const blocked = { ...MEETING_STEPS[0], status: "blocked" as const, error_class: "auth_expired", error_message: "Google account is not connected" };
    const t = task({ status: "blocked", failure_code: "integration_not_connected", steps: [blocked] });
    expect(isConnectionBlock(t)).toBe(true);
    render(<RecoveryPanel task={t} actions={actions()} entries={[]} />);
    expect(screen.getByText("Blocked — Google needs to be connected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Connect Google/ })).toHaveAttribute("href", "/app/integrations");
    expect(screen.getByRole("button", { name: /I've connected it — resume/ })).toBeInTheDocument();
  });

  it("explains failures: what, which step, why, and what you can do", () => {
    const failed = { ...MEETING_STEPS[0], status: "failed" as const, attempt_count: 3, error_class: "transient", error_message: "Google Calendar is temporarily unavailable." };
    render(
      <RecoveryPanel
        task={task({ status: "failed", failure_code: "integration_temporarily_unavailable", failure_message: "The external service is temporarily unavailable.", steps: [failed] })}
        actions={actions()}
        entries={[]}
      />,
    );
    expect(screen.getByText("What failed")).toBeInTheDocument();
    expect(screen.getByText(/Step 1: Find a free 30-minute slot/)).toBeInTheDocument();
    expect(screen.getByText(/3 attempts/)).toBeInTheDocument();
    expect(screen.getByText("What you can do")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Resume/ }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
  });
});
