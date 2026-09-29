import type { Metadata } from "next";
import { AdminFeatureFlags } from "@/components/admin/admin-feature-flags";

export const metadata: Metadata = { title: "Feature flags" };

export default function AdminFlagsPage() {
  return <AdminFeatureFlags />;
}
