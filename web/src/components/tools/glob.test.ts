import { describe, expect, it } from "vitest";
import { agentToolAccess, globToRegExp, matchesPattern, matchingNames, patternSuggestions } from "./glob";

const TOOLS = ["gmail.send", "gmail.search", "calendar.create_event", "calendar.list_events", "mcp.demo.echo"];

describe("fnmatch-compatible tool patterns", () => {
  it("matches exact names and anchors both ends", () => {
    expect(matchesPattern("gmail.send", "gmail.send")).toBe(true);
    expect(matchesPattern("gmail.send_later", "gmail.send")).toBe(false);
    expect(matchesPattern("xgmail.send", "gmail.send")).toBe(false);
  });

  it("treats dots literally and * as any run of characters (including dots)", () => {
    expect(matchesPattern("gmailXsend", "gmail.send")).toBe(false);
    expect(matchingNames("gmail.*", TOOLS)).toEqual(["gmail.send", "gmail.search"]);
    expect(matchingNames("mcp.*", TOOLS)).toEqual(["mcp.demo.echo"]);
    expect(matchingNames("*", TOOLS)).toHaveLength(TOOLS.length);
    expect(matchingNames("*.list_*", TOOLS)).toEqual(["calendar.list_events"]);
  });

  it("supports ? and character classes", () => {
    expect(matchesPattern("gmail.send", "gmail.s?nd")).toBe(true);
    expect(matchesPattern("gmail.send", "gmail.[st]end")).toBe(true);
    expect(matchesPattern("gmail.send", "gmail.[!s]end")).toBe(false);
  });

  it("is case-sensitive like fnmatchcase", () => {
    expect(matchesPattern("Gmail.send", "gmail.*")).toBe(false);
  });

  it("never throws on unbalanced brackets", () => {
    expect(() => globToRegExp("gmail.[")).not.toThrow();
    expect(matchesPattern("gmail.[", "gmail.[")).toBe(true);
  });
});

describe("agentToolAccess", () => {
  it("permits tools matching allowed and not denied (deny wins)", () => {
    const { permitted, blocked } = agentToolAccess(TOOLS, ["*"], ["gmail.send", "mcp.*"]);
    expect(permitted).toEqual(["gmail.search", "calendar.create_event", "calendar.list_events"]);
    expect(blocked).toEqual(["gmail.send", "mcp.demo.echo"]);
  });

  it("an empty allow list permits nothing", () => {
    expect(agentToolAccess(TOOLS, [], []).permitted).toEqual([]);
  });
});

describe("patternSuggestions", () => {
  it("offers namespace wildcards before concrete names", () => {
    const s = patternSuggestions(TOOLS);
    expect(s.slice(0, 4)).toEqual(["calendar.*", "gmail.*", "mcp.*", "mcp.demo.*"]);
    expect(s).toContain("gmail.send");
  });
});
