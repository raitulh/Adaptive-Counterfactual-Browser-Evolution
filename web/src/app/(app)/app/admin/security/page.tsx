import type { Metadata } from "next";
import { AdminSecurityEvents } from "@/components/admin/admin-security-events";

export const metadata: Metadata = { title: "Security events" };

export default function AdminSecurityPage() {
  return <AdminSecurityEvents />;
}
