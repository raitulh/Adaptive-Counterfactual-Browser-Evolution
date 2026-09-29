import type { Metadata } from "next";
import { Suspense } from "react";
import { OrganizationSettings } from "@/components/organization/organization-settings";

export const metadata: Metadata = { title: "Organization · Settings" };

export default function OrganizationSettingsPage() {
  return (
    <Suspense>
      <OrganizationSettings />
    </Suspense>
  );
}
