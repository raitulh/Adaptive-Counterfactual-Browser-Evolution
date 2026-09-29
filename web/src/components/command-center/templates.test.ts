import { describe, expect, it } from "vitest";
import {
  applyCommand,
  buildContext,
  buildTaskCreate,
  commandById,
  matchCommands,
  nextPlaceholder,
  slashQuery,
} from "./templates";

describe("slash commands", () => {
  it("detects a slash token at the start of the text or a line", () => {
    expect(slashQuery("/sch", 4)).toEqual({ query: "sch", start: 0 });
    expect(slashQuery("hello\n/re", 9)).toEqual({ query: "re", start: 6 });
    expect(slashQuery("a/b", 3)).toBeNull();
    expect(slashQuery("/schedule now", 13)).toBeNull();
  });

  it("filters commands by prefix", () => {
    expect(matchCommands("").map((c) => c.id)).toEqual(["research", "schedule", "analyze", "email", "automate"]);
    expect(matchCommands("a").map((c) => c.id)).toEqual(["analyze", "automate"]);
    expect(matchCommands("zz")).toEqual([]);
  });

  it("replaces the token with the template and selects the first placeholder", () => {
    const cmd = commandById("schedule");
    const { text, selection } = applyCommand("/sch", 0, 4, cmd);
    expect(text).toBe(cmd.template);
    expect(text.slice(selection.start, selection.end)).toBe("[30-minute]");
  });

  it("walks placeholders forward and wraps around", () => {
    const t = "Email [person] about [subject].";
    const first = nextPlaceholder(t, 0)!;
    expect(t.slice(first.start, first.end)).toBe("[person]");
    const second = nextPlaceholder(t, first.end)!;
    expect(t.slice(second.start, second.end)).toBe("[subject]");
    expect(nextPlaceholder(t, second.end)).toEqual(first);
    expect(nextPlaceholder("no placeholders", 0)).toBeNull();
  });
});

describe("request building", () => {
  it("references uploaded files in context so the planner can read them", () => {
    expect(buildContext("", [])).toBeNull();
    expect(
      buildContext("  Use Q3 numbers ", [
        { id: "f1", filename: "q3.csv" },
        { id: "f2", filename: "notes.md" },
      ]),
    ).toBe("Use Q3 numbers\n\nAttached files: q3.csv (file_id f1), notes.md (file_id f2)");
  });

  it("builds a minimal TaskCreate", () => {
    expect(
      buildTaskCreate({
        goal: "  Plan my week ",
        context: "",
        agentId: null,
        priority: 100,
        maxDurationSeconds: null,
        files: [],
      }),
    ).toEqual({
      goal: "Plan my week",
      priority: 100,
    });
    expect(
      buildTaskCreate({ goal: "x", context: "c", agentId: "a1", priority: 50, maxDurationSeconds: 900, files: [] }),
    ).toEqual({
      goal: "x",
      context: "c",
      agent_id: "a1",
      priority: 50,
      max_duration_seconds: 900,
    });
  });
});
