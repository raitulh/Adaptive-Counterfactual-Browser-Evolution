import type { Metadata } from "next";
import { Suspense } from "react";
import { ApprovalsCenter } from "@/components/approvals/approvals-center";

export const metadata: Metadata = { title: "Approvals" };

export default function ApprovalsPage() {
  // useSearchParams (deep link ?focus=<id>) needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <ApprovalsCenter />
    </Suspense>
  );
}
