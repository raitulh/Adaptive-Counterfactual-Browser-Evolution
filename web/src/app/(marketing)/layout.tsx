import { RevealOnScroll } from "@/components/marketing/reveal";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

/** Public, indexable pages: shared header and footer around a single <main> landmark. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip">
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      <RevealOnScroll />
    </div>
  );
}
