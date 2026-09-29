import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminTaskLookup } from "@/components/admin/admin-task-lookup";

export const metadata: Metadata = { title: "Task lookup" };

export default function AdminTaskLookupPage() {
  return (
    <Suspense>
      <AdminTaskLookup />
    </Suspense>
  );
}
