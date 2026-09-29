/**
 * Scripted planner of the demo — the same goal → plan scenarios as `backend/scripts/simulated_backend.py`:
 *
 *   "meeting" / "schedule" / "calendar" / "invite"  find slot → contact → create event (approval) → e-mail (approval)
 *        "... with <Name> ..." picks the contact; an unknown name (e.g. "Zoe") asks you for the address
 *   "flaky"                                         the first calendar calls fail (503) → retries → failed → resume works
 *   "draft"                                         contact → Gmail draft (write, verified by read-back)
 *   "email" / "send" / "message"                    contact → Gmail send (approval)
 *   "inbox" / "unread"                              Gmail search (read-only)
 *   "remember"                                      saves a memory
 *   "clarify" or a goal of 1–2 words               the planner asks a question first (waiting_input)
 *   anything else                                   a direct answer (no tools; not externally verified)
 */

export interface PlannedStep {
  step_id: string;
  action: string;
  tool: string;
  arguments: Record<string, unknown>;
  dependencies: string[];
  risk_level: "low" | "medium" | "high" | "critical";
  requires_approval: boolean;
  verification_method?: string;
}

export interface Plan {
  goal: string;
  summary: string;
  steps: PlannedStep[];
  needs_user_input: string[];
  direct_response: string | null;
  /** Simulated provider trouble: this many calendar calls fail with 503 first. */
  flakyCalendarFailures: number;
}

/** Example goals, one per scenario (used by the demo UI and tests). */
export const DEMO_GOALS = {
  meeting:
    "Check my calendar tomorrow, find a free 30-minute slot after 2 PM, schedule a meeting with Rahim, and send him a confirmation email.",
  unknownContact: "Schedule a 30-minute meeting with Zoe tomorrow afternoon and send her a confirmation.",
  flaky: "Schedule a meeting with Sara tomorrow after 2 PM (the calendar API is flaky today).",
  draft: "Draft a follow-up email to Omar about the launch timeline.",
  send: "Send an email to Priya with a short status update on the proposal.",
  inbox: "Summarize my unread emails from the last day.",
  remember: "Remember that I prefer 25-minute meetings on Fridays.",
  clarify: "Help me",
  answer: "What is the difference between an approval and a verification in AgentOS?",
} as const;

function contactName(text: string): string {
  return /\b(?:with|to|email|e-mail)\s+([A-Z][a-z]+)/.exec(text)?.[1] ?? "Rahim";
}

function step(
  step_id: string,
  action: string,
  tool: string,
  args: Record<string, unknown>,
  deps: string[] = [],
  risk: PlannedStep["risk_level"] = "low",
  approval = false,
  extra: Partial<PlannedStep> = {},
): PlannedStep {
  return {
    step_id,
    action,
    tool,
    arguments: args,
    dependencies: deps,
    risk_level: risk,
    requires_approval: approval,
    ...extra,
  };
}

const has = (text: string, keys: string[]) => keys.some((k) => text.includes(k));

export function planFor(goal: string, answers = ""): Plan {
  // Answers to the planner's questions refine the request (the scripted "model" reads both).
  const text = answers ? `${goal}\n${answers}` : goal;
  const g = text.toLowerCase();
  const name = contactName(text);
  const ref = { $ref: "steps.find_contact.output.best.email" };
  const base: Plan = {
    goal,
    summary: "",
    steps: [],
    needs_user_input: [],
    direct_response: null,
    flakyCalendarFailures: 0,
  };

  if ((g.includes("clarify") || goal.trim().split(/\s+/).length <= 2) && !answers) {
    return {
      ...base,
      summary: "Clarify the request first.",
      needs_user_input: ["What exactly should I do, and for whom?"],
    };
  }
  if (g.includes("remember")) {
    const content =
      goal
        .replace(/remember( that)?/i, "")
        .trim()
        .replace(/^[\s:,.]+|[\s:,.]+$/g, "") || goal;
    return {
      ...base,
      summary: "Save this to memory.",
      steps: [
        step("save", "Save the preference", "memory.save", { content, memory_type: "preference", importance: 0.7 }),
      ],
    };
  }
  if (has(g, ["meeting", "schedule", "calendar", "invite"])) {
    return {
      ...base,
      summary: `Find a free 30-minute slot tomorrow after 2 PM, invite ${name}, then e-mail a confirmation.`,
      flakyCalendarFailures: g.includes("flaky") ? 3 : 0,
      steps: [
        step("find_slot", "Find a free 30-minute slot tomorrow after 2 PM", "calendar.find_free_slots", {
          date: "tomorrow",
          duration_minutes: 30,
          earliest_time: "14:00",
          latest_time: "18:00",
        }),
        step("find_contact", `Look up ${name}'s e-mail address`, "contacts.lookup", { name }),
        step(
          "create_meeting",
          `Schedule the meeting with ${name}`,
          "calendar.create_event",
          {
            summary: `Meeting with ${name}`,
            start: { $ref: "steps.find_slot.output.slots.0.start" },
            end: { $ref: "steps.find_slot.output.slots.0.end" },
            attendees: [ref],
          },
          ["find_slot", "find_contact"],
          "medium",
          true,
          { verification_method: "read_back" },
        ),
        step(
          "send_confirmation",
          `E-mail ${name} a confirmation`,
          "gmail.send",
          {
            to: [ref],
            subject: "Meeting confirmation",
            body: `Hi ${name},\n\nOur meeting is confirmed for {{steps.create_meeting.output.start}}.\n\nBest regards`,
          },
          ["create_meeting", "find_contact"],
          "high",
          true,
        ),
      ],
    };
  }
  if (g.includes("draft")) {
    return {
      ...base,
      summary: `Draft an e-mail to ${name} for your review.`,
      steps: [
        step("find_contact", `Look up ${name}'s e-mail address`, "contacts.lookup", { name }),
        step(
          "draft",
          `Draft the e-mail to ${name}`,
          "gmail.create_draft",
          {
            to: [ref],
            subject: "Quick follow-up",
            body: `Hi ${name},\n\nFollowing up on our conversation.`,
          },
          ["find_contact"],
        ),
      ],
    };
  }
  if (has(g, ["inbox", "unread"])) {
    return {
      ...base,
      summary: "Scan recent unread e-mail.",
      steps: [
        step("scan", "Search unread e-mail from the last day", "gmail.search", {
          query: "is:unread newer_than:1d",
          max_results: 20,
        }),
      ],
    };
  }
  if (has(g, ["email", "e-mail", "send", "message"])) {
    return {
      ...base,
      summary: `Send ${name} an e-mail after your approval.`,
      steps: [
        step("find_contact", `Look up ${name}'s e-mail address`, "contacts.lookup", { name }),
        step(
          "send",
          `E-mail ${name}`,
          "gmail.send",
          {
            to: [ref],
            subject: "Hello from AgentOS",
            body: `Hi ${name},\n\n${goal}\n\nBest regards`,
          },
          ["find_contact"],
          "high",
          true,
        ),
      ],
    };
  }
  const topic = goal.replace(/[?.!\s]+$/, "");
  return {
    ...base,
    summary: "Answer directly.",
    direct_response:
      `**Simulated answer** — ${topic}.\n\n` +
      "This response comes from the scripted planner of the AgentOS demo (no model or tools were called). " +
      "With a configured model, AgentOS would research and answer this, citing its sources.",
  };
}
