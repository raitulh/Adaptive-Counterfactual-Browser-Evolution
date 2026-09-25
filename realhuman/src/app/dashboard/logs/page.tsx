import type { Metadata } from "next";
import { LogsView } from "@/components/dashboard/views/logs-view";

export const metadata: Metadata = { title: "Logs" };

export default function LogsPage() {
  return <LogsView />;
}
