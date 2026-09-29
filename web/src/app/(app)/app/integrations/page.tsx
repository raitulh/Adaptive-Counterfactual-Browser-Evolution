import type { Metadata } from "next";
import { Suspense } from "react";
import { IntegrationsPage } from "@/components/integrations/integrations-page";

export const metadata: Metadata = { title: "Integrations" };

export default function Page() {
  return (
    <Suspense>
      <IntegrationsPage />
    </Suspense>
  );
}
