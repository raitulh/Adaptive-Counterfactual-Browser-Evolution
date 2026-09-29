import type { Metadata } from "next";
import {
  AcbeSection,
  AutomationsSection,
  McpSection,
  MemorySection,
} from "@/components/marketing/home/capability-sections";
import { DemoSection, FinalCta, PricingTeaser, SecuritySection } from "@/components/marketing/home/closing-sections";
import { Hero, LoopSection, WhatIsSection } from "@/components/marketing/home/story-sections";
import { ToolsSection } from "@/components/marketing/home/tools-section";
import { TrustSection } from "@/components/marketing/home/trust-section";
import { marketingMetadata, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "@/components/marketing/metadata";
import { JsonLd } from "@/components/marketing/primitives";
import { StoryStage } from "@/components/marketing/story/story-stage";
import { env } from "@/lib/config/env";

// Plans in the teaser are cached for 5 minutes (ISR); the rest of the page is static.
export const revalidate = 300;

export const metadata: Metadata = marketingMetadata({
  title: `${SITE_NAME} — ${SITE_TAGLINE}`,
  description: SITE_DESCRIPTION,
  path: "/",
  home: true,
});

const STORY_DESCRIPTION =
  "Illustration: the AgentOS core — an execution engine inside a verification ring, with tools (Gmail, Calendar, Drive, Web, Browser, Memory, MCP, Files, Search) on an orbit around it. As the page scrolls it shows a goal arriving, a plan graph forming, approved actions flowing to Calendar and Gmail, the ring verifying each result, and memory consolidating what was learned.";

function structuredData() {
  const url = env.siteUrl;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${url}/#organization`,
        name: SITE_NAME,
        url,
        logo: `${url}/icon/512`,
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${url}/#software`,
        name: SITE_NAME,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "AI agent platform",
        operatingSystem: "Web",
        url,
        description: SITE_DESCRIPTION,
        publisher: { "@id": `${url}/#organization` },
        featureList: [
          "Goal → plan → validate → approve → execute → verify → recover → complete lifecycle",
          "Policy engine with allow, require-approval and deny decisions",
          "Action-bound, expiring, single-use approvals",
          "Read-back verification against the real system",
          "Reconciliation instead of blind retries",
          "Tenant isolation, encrypted credentials and an append-only audit log",
          "Memory with confidence and freshness",
          "Scheduled automations",
          "MCP servers with admin approval and schema-change review",
          "Controlled self-improvement with experiments, canary, promotion and rollback",
        ],
      },
    ],
  };
}

export default function HomePage() {
  return (
    <>
      <JsonLd data={structuredData()} />
      <StoryStage description={STORY_DESCRIPTION}>
        <Hero />
        <WhatIsSection />
        <LoopSection />
      </StoryStage>
      <ToolsSection />
      <DemoSection />
      <TrustSection />
      <MemorySection />
      <AutomationsSection />
      <McpSection />
      <AcbeSection />
      <SecuritySection />
      <PricingTeaser />
      <FinalCta />
    </>
  );
}
