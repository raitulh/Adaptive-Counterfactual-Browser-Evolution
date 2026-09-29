import type { Metadata } from "next";
import { AutomationDetail } from "@/components/automations/automation-detail";

export const metadata: Metadata = { title: "Automation" };

export default async function AutomationPage({ params }: { params: Promise<{ automationId: string }> }) {
  const { automationId } = await params;
  return <AutomationDetail automationId={automationId} />;
}
