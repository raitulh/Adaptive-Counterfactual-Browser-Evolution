import { describe, expect, it } from "vitest";
import { memoryTypeValues } from "@/lib/api";
import {
  PRIMARY_SECTIONS,
  SECONDARY_SECTIONS,
  confidenceLevel,
  describeSource,
  freshnessWindow,
  memoryTypeMeta,
  presentMemory,
} from "./presentation";

describe("memory sections", () => {
  it("covers every backend MemoryType exactly once and invents none", () => {
    const sections = [...PRIMARY_SECTIONS, ...SECONDARY_SECTIONS].sort();
    expect(sections).toEqual([...memoryTypeValues].sort());
    expect(Object.keys(memoryTypeMeta).sort()).toEqual([...memoryTypeValues].sort());
  });

  it("mirrors the backend freshness windows", () => {
    expect(memoryTypeMeta.verified_fact.maxAgeDays).toBe(90);
    expect(memoryTypeMeta.contact.maxAgeDays).toBe(180);
    expect(memoryTypeMeta.short_term.maxAgeDays).toBe(1);
  });
});

describe("confidenceLevel", () => {
  it("uses the backend's 0.5 'unverified' threshold", () => {
    expect(confidenceLevel(1).level).toBe("high");
    expect(confidenceLevel(0.8).level).toBe("high");
    expect(confidenceLevel(0.5).level).toBe("medium");
    expect(confidenceLevel(0.49).level).toBe("low");
    expect(confidenceLevel(0.49).tone).toBe("warning");
  });
});

describe("presentMemory", () => {
  it("renders fresh, confident, active memories plainly", () => {
    const p = presentMemory({ freshness: "fresh", confidence: 1, status: "active" });
    expect(p.uncertain).toBe(false);
    expect(p.tags).toEqual([]);
    expect(p.canVerify).toBe(true);
  });

  it("marks stale memories as uncertain with an explicit tag", () => {
    const p = presentMemory({ freshness: "stale", confidence: 0.9, status: "active" });
    expect(p.uncertain).toBe(true);
    expect(p.tags.map((t) => t.label)).toEqual(["Stale"]);
    expect(p.freshness.tone).toBe("warning");
  });

  it("marks low-confidence memories as unverified", () => {
    const p = presentMemory({ freshness: "unverified", confidence: 0.3, status: "active" });
    expect(p.uncertain).toBe(true);
    expect(p.tags.map((t) => t.label)).toEqual(["Unverified"]);
    expect(p.confidence.level).toBe("low");
  });

  it("explains conflicts once and still allows verifying", () => {
    const p = presentMemory({ freshness: "unverified", confidence: 0.9, status: "conflicted" });
    expect(p.tags.map((t) => t.label)).toEqual(["Conflicted"]);
    expect(p.canVerify).toBe(true);
  });

  it("never offers to verify a superseded memory (the backend refuses)", () => {
    const p = presentMemory({ freshness: "fresh", confidence: 1, status: "superseded" });
    expect(p.canVerify).toBe(false);
    expect(p.uncertain).toBe(true);
    expect(p.tags[0].label).toBe("Superseded");
  });
});

describe("describeSource", () => {
  it("links task sources to the task", () => {
    expect(describeSource("task", "task:01a0eb8a-e6bb-75ac-8174-0a7049f20402")).toEqual({
      label: "Saved during a task",
      href: "/app/tasks/01a0eb8a-e6bb-75ac-8174-0a7049f20402",
      taskId: "01a0eb8a-e6bb-75ac-8174-0a7049f20402",
    });
  });

  it("labels user statements without exposing ids", () => {
    expect(describeSource("user_stated", "user:123")).toEqual({ label: "You told AgentOS" });
  });
});

describe("freshnessWindow", () => {
  it("reports how much of the type's window has elapsed", () => {
    const now = Date.parse("2026-09-29T00:00:00Z");
    const w = freshnessWindow("verified_fact", "2026-08-30T00:00:00Z", now);
    expect(Math.round(w.elapsedDays)).toBe(30);
    expect(w.used).toBeCloseTo(30 / 90, 2);
    expect(Math.round(w.remainingDays)).toBe(60);
    expect(freshnessWindow("verified_fact", "2025-01-01T00:00:00Z", now).used).toBe(1);
  });
});
