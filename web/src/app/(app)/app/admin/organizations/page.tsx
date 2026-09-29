import type { Metadata } from "next";
import { AdminOrganizations } from "@/components/admin/admin-organizations";

export const metadata: Metadata = { title: "Organizations" };

export default function AdminOrganizationsPage() {
  return <AdminOrganizations />;
}
