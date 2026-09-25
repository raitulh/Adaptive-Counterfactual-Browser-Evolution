import { DashboardPreview } from "@/components/marketing/dashboard-preview";
import { DemoSection } from "@/components/marketing/demo-section";
import { DeveloperApi } from "@/components/marketing/developer-api";
import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Pricing } from "@/components/marketing/pricing";
import { ProblemSection } from "@/components/marketing/problem-section";
import { SecurityPrivacy } from "@/components/marketing/security-privacy";
import { SignalEngine } from "@/components/marketing/signal-engine";
import { UseCases } from "@/components/marketing/use-cases";
import { ValueStrip } from "@/components/marketing/value-strip";
import { siteConfig } from "@/lib/constants/site";

function StructuredData() {
  if (!siteConfig.url) return null;
  const data = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteConfig.name,
    url: siteConfig.url,
    description: siteConfig.description,
  };
  return (
    <script
      type="application/ld+json"
      // JSON.stringify output with "<" escaped cannot break out of the script element.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

export default function HomePage() {
  return (
    <>
      <StructuredData />
      <Hero />
      <DemoSection />
      <ValueStrip />
      <div id="product" data-anchor>
        <ProblemSection />
        <HowItWorks />
        <SignalEngine />
      </div>
      <DeveloperApi />
      <UseCases />
      <SecurityPrivacy />
      <DashboardPreview />
      <Pricing />
      <Faq />
      <FinalCta />
    </>
  );
}
