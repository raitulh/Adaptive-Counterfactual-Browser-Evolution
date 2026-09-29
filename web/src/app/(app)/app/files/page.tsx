import type { Metadata } from "next";
import { Suspense } from "react";
import { FilesView } from "@/components/files/files-view";

export const metadata: Metadata = { title: "Files" };

export default function FilesPage() {
  return (
    <Suspense>
      <FilesView />
    </Suspense>
  );
}
