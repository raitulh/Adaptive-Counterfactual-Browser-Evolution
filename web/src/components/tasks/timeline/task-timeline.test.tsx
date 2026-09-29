import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TaskEvent } from "@/lib/api";
import { MEETING_EVENTS, MEETING_STEPS, meetingEventsUntil } from "./fixtures";
import { TaskTimeline } from "./task-timeline";

describe("TaskTimeline (pure)", () => {
  it("renders phases and human sentences from events alone", () => {
    render(<TaskTimeline events={MEETING_EVENTS} steps={MEETING_STEPS} taskStatus="completed" animate={false} />);
    expect(screen.getByRole("list", { name: "Execution timeline" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Verification" }).length).toBe(3);
    expect(screen.getByText("Plan validated · 4 steps")).toBeInTheDocument();
    expect(screen.getByText("calendar.create_event")).toBeInTheDocument();
    expect(screen.getByText("Completed — every action verified")).toBeInTheDocument();
    // Raw payloads stay hidden unless developer mode is on.
    expect(screen.queryByText(/Advanced event data/)).not.toBeInTheDocument();
  });

  it("offers advanced event data in developer mode and marks live work for screen readers", () => {
    render(
      <TaskTimeline
        events={meetingEventsUntil(11)}
        steps={MEETING_STEPS}
        taskStatus="running"
        developerMode
        animate={false}
      />,
    );
    expect(screen.getAllByRole("button", { name: /Advanced event data/ }).length).toBeGreaterThan(3);
    expect(screen.getAllByText(/— In progress/).length).toBeGreaterThan(0);
  });

  it("shows the empty node without events and virtualizes long histories", () => {
    const { rerender } = render(<TaskTimeline events={[]} empty={<p>Nothing yet</p>} />);
    expect(screen.getByText("Nothing yet")).toBeInTheDocument();
    const many: TaskEvent[] = Array.from({ length: 400 }, (_, i) => ({
      seq: i + 1,
      event_type: "RETRY_SCHEDULED",
      step_id: `s${i}`,
      actor_type: "system",
      payload: { step: "find_slot", delay_seconds: 1 },
      created_at: new Date(Date.UTC(2026, 8, 29, 5, 0, 0, i)).toISOString(),
    }));
    rerender(<TaskTimeline events={many} virtualizeAfter={150} />);
    expect(screen.getByLabelText("Execution timeline (scrollable)")).toBeInTheDocument();
  });
});
