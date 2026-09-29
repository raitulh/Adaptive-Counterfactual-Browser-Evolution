import type { Metadata } from "next";
import { Suspense } from "react";
import { ToolsPage } from "@/components/tools/tools-page";

export const metadata: Metadata = { title: "Tools" };

export default function Page() {
  return (
    <Suspense>
      <ToolsPage />
    </Suspense>
  );
}
