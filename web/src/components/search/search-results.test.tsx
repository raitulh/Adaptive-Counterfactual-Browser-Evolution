import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { DocumentSearchResponse, WebSearchResponse } from "@/lib/api";
import { AgentOSApiError } from "@/lib/api/errors";
import { DocumentResults } from "./document-results";
import { queryTerms } from "./highlight";
import { SearchErrorPanel } from "./search-error";
import { WebResults } from "./web-results";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const wrap = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>);

const web: WebSearchResponse = {
  query: "falcon budget",
  provider: "brave",
  retrieved_at: "2026-09-29T05:00:00Z",
  results: [
    {
      rank: 1,
      title: "Falcon budget planning guide",
      url: "https://www.example.com/guides/falcon",
      snippet: "How to run a budget review for Project Falcon.",
      provider: "brave",
      provider_rank: 2,
      relevance: 0.82,
      retrieved_at: "2026-09-29T05:00:00Z",
      published_at: "2026-09-01T00:00:00Z",
      citation: {
        source_url: "https://www.example.com/guides/falcon",
        title: "Falcon budget planning guide",
        provider: "brave",
        retrieved_at: "2026-09-29T05:00:00Z",
        relevance: 0.82,
      },
    },
    {
      rank: 2,
      title: "Unsafe link",
      url: "javascript:alert(1)",
      snippet: "",
      provider: "brave",
      provider_rank: 3,
      relevance: 0.2,
      retrieved_at: "2026-09-29T05:00:00Z",
      citation: { source_url: "javascript:alert(1)", title: "Unsafe", provider: "brave", retrieved_at: "2026-09-29T05:00:00Z", relevance: 0.2 },
    },
  ],
};

describe("<WebResults>", () => {
  it("shows domain, provider, relevance, dates and highlighted terms", () => {
    wrap(<WebResults data={web} terms={queryTerms(web.query)} onEscape={() => {}} />);
    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(screen.getByText("brave #2")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Relevance 0.82" })).toBeInTheDocument();
    expect(screen.getByText(/Published/)).toBeInTheDocument();
    const marks = [...document.querySelectorAll("mark")].map((m) => m.textContent?.toLowerCase());
    expect(marks).toEqual(expect.arrayContaining(["falcon", "budget"]));
  });

  it("links only to http(s) URLs, in a new tab without referrer", () => {
    wrap(<WebResults data={web} terms={[]} onEscape={() => {}} />);
    const link = screen.getByRole("link", { name: "Falcon budget planning guide" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("link", { name: "Unsafe link" })).toBeNull();
  });

  it("moves between results with the arrow keys and returns to the box with Escape", async () => {
    const onEscape = vi.fn();
    wrap(<WebResults data={web} terms={[]} onEscape={onEscape} />);
    const items = screen.getAllByRole("article");
    items[0].focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(items[1]);
    await userEvent.keyboard("{Escape}");
    expect(onEscape).toHaveBeenCalled();
  });

  it("copies a formatted citation", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    wrap(<WebResults data={web} terms={[]} onEscape={() => {}} />);
    await user.click(screen.getAllByRole("button", { name: "Copy citation" })[0]);
    expect(writeText).toHaveBeenCalledWith(
      "Falcon budget planning guide. https://www.example.com/guides/falcon (via brave, retrieved 2026-09-29)",
    );
  });
});

describe("<DocumentResults>", () => {
  const docs: DocumentSearchResponse = {
    query: "falcon",
    used_vector_search: false,
    results: [
      {
        document_id: "d1",
        chunk_id: "c1",
        source_type: "file",
        source_id: "file-1",
        title: "notes.txt",
        chunk_index: 0,
        content: "The Falcon launch is in November.",
        score: 0.03,
        keyword_score: 0.02,
        vector_score: null,
      },
    ],
  };

  it("shows scores, the ranking mode and opens the file with Enter", async () => {
    wrap(<DocumentResults data={docs} terms={["falcon"]} onEscape={() => {}} />);
    expect(screen.getByText("keyword ranking only")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Keyword 0.020" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Vector/ })).toBeNull();
    expect(document.querySelector("mark")?.textContent).toBe("Falcon");
    screen.getByRole("article").focus();
    await userEvent.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/app/files?file=file-1");
  });
});

describe("<SearchErrorPanel>", () => {
  const err = (status: number, code: string, message = "m", retryAfterSeconds?: number) =>
    new AgentOSApiError({ status, code, message, requestId: "req-1", retryAfterSeconds });

  it("explains a missing web search provider and offers the other tabs", async () => {
    const onSwitchTab = vi.fn();
    wrap(
      <SearchErrorPanel error={err(503, "configuration_missing")} tab="web" failedAt={Date.now()} onSwitchTab={onSwitchTab} onRetry={() => {}} />,
    );
    expect(screen.getByText("Web search isn't set up on this server")).toBeInTheDocument();
    expect(screen.getByText("SEARCH_PROVIDER")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Search your documents/ }));
    expect(onSwitchTab).toHaveBeenCalledWith("documents");
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
  });

  it("distinguishes a disabled feature", () => {
    wrap(<SearchErrorPanel error={err(403, "feature_disabled")} tab="web" failedAt={Date.now()} onSwitchTab={() => {}} onRetry={() => {}} />);
    expect(screen.getByText("Web search is turned off for this organization")).toBeInTheDocument();
  });

  it("shows a permission error for a missing permission", () => {
    wrap(<SearchErrorPanel error={err(403, "forbidden")} tab="web" failedAt={Date.now()} onSwitchTab={() => {}} onRetry={() => {}} />);
    expect(screen.getByText("You don't have permission to do this")).toBeInTheDocument();
  });

  it("counts down a rate limit before allowing a retry", () => {
    wrap(<SearchErrorPanel error={err(429, "rate_limited", "Too many", 20)} tab="web" failedAt={Date.now()} onSwitchTab={() => {}} onRetry={() => {}} />);
    expect(screen.getByText("You've reached the search limit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again in \d+s/ })).toBeDisabled();
  });

  it("names the provider when the provider is rate limiting", () => {
    wrap(<SearchErrorPanel error={err(429, "integration_rate_limited")} tab="web" failedAt={Date.now()} onSwitchTab={() => {}} onRetry={() => {}} />);
    expect(screen.getByText("The search provider is limiting requests")).toBeInTheDocument();
  });
});
