import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  domainOf,
  formatCitation,
  formatMarkdownCitation,
  highlightSegments,
  isSafeHttpUrl,
  matchedTermCount,
  queryTerms,
} from "./highlight";
import { HighlightText } from "./highlight-text";

describe("queryTerms", () => {
  it("keeps quoted phrases, drops exclusions, stopwords and punctuation", () => {
    expect(queryTerms('What is the "Project Falcon" budget? -draft')).toEqual(["Project Falcon", "budget"]);
  });

  it("de-duplicates case-insensitively and orders longest first", () => {
    expect(queryTerms("budget Budget review")).toEqual(["budget", "review"]);
    expect(queryTerms("ai finance")).toEqual(["finance", "ai"]);
  });

  it("ignores single characters and empty input", () => {
    expect(queryTerms("a b c")).toEqual([]);
    expect(queryTerms("")).toEqual([]);
  });
});

describe("highlightSegments", () => {
  it("matches case-insensitively and preserves the original text", () => {
    const segs = highlightSegments("The launch of Project FALCON is in November.", ["falcon", "launch"]);
    expect(segs.map((s) => s.text).join("")).toBe("The launch of Project FALCON is in November.");
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(["launch", "FALCON"]);
  });

  it("prefers the longest term (phrases beat single words)", () => {
    const segs = highlightSegments("Project Falcon and falcon", queryTerms('"project falcon" falcon'));
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(["Project Falcon", "falcon"]);
  });

  it("treats regex characters literally", () => {
    const segs = highlightSegments("costs (Q3) rose 5.0%", ["(Q3)", "5.0%"]);
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(["(Q3)", "5.0%"]);
  });

  it("matches phrases across irregular whitespace", () => {
    const segs = highlightSegments("Project\n  Falcon", ["Project Falcon"]);
    expect(segs).toEqual([{ text: "Project\n  Falcon", match: true }]);
  });

  it("returns the whole text unhighlighted without terms", () => {
    expect(highlightSegments("hello", [])).toEqual([{ text: "hello", match: false }]);
  });

  it("counts matched terms", () => {
    expect(matchedTermCount("budget review on Monday", ["budget", "falcon", "monday"])).toBe(2);
  });
});

describe("<HighlightText>", () => {
  it("wraps matches in <mark>", () => {
    const { container } = render(<HighlightText text="Budget review with finance" terms={["budget", "finance"]} />);
    const marks = [...container.querySelectorAll("mark")].map((m) => m.textContent);
    expect(marks).toEqual(["Budget", "finance"]);
    expect(container.textContent).toBe("Budget review with finance");
  });
});

describe("result helpers", () => {
  it("extracts a readable domain", () => {
    expect(domainOf("https://www.example.com/a?b=1")).toBe("example.com");
    expect(domainOf("not a url")).toBe("not a url");
  });

  it("only treats http(s) links as safe", () => {
    expect(isSafeHttpUrl("https://example.com")).toBe(true);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
  });

  it("formats citations", () => {
    const c = { title: "AgentOS docs", source_url: "https://example.com/docs", provider: "brave", retrieved_at: "2026-09-29T05:00:00Z" };
    expect(formatCitation(c)).toBe("AgentOS docs. https://example.com/docs (via brave, retrieved 2026-09-29)");
    expect(formatMarkdownCitation({ ...c, title: "A [b]" })).toBe("[A b](https://example.com/docs)");
  });
});
