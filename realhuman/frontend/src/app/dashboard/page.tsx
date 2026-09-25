import type { Metadata } from "next";
import { OverviewView } from "@/components/dashboard/views/overview-view";

export const metadata: Metadata = { title: "Overview" };

export default function DashboardPage() {
  return <OverviewView />;
}
