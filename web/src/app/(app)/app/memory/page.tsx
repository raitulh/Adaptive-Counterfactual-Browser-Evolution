import type { Metadata } from "next";
import { Suspense } from "react";
import { MemoryView } from "@/components/memory/memory-view";

export const metadata: Metadata = { title: "Memory" };

export default function MemoryPage() {
  return (
    <Suspense>
      <MemoryView />
    </Suspense>
  );
}
