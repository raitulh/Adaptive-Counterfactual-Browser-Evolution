import type { Metadata } from "next";
import { Suspense } from "react";
import { UsageOverview } from "@/components/usage/usage-overview";

export const metadata: Metadata = { title: "Usage" };

export default function UsagePage() {
  return (
    <Suspense>
      <UsageOverview />
    </Suspense>
  );
}
