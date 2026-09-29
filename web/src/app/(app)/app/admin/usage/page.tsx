import type { Metadata } from "next";
import { AdminUsage } from "@/components/admin/admin-usage";

export const metadata: Metadata = { title: "Usage" };

export default function AdminUsagePage() {
  return <AdminUsage />;
}
