import type { Metadata } from "next";
import { SessionsSettings } from "@/components/settings/sessions-settings";

export const metadata: Metadata = { title: "Sessions · Settings" };

export default function SessionsSettingsPage() {
  return <SessionsSettings />;
}
