import type { Metadata } from "next";
import { SystemOverview } from "@/components/admin/system-overview";

export const metadata: Metadata = { title: "System" };

export default function AdminSystemPage() {
  return <SystemOverview />;
}
