import type { ReactNode } from "react";
import { Footer } from "@/components/marketing/footer";
import { Navbar } from "@/components/marketing/navbar";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Navbar />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <Footer />
    </>
  );
}
