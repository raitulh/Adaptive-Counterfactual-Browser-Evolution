import type { Metadata } from "next";
import { AgentsPage } from "@/components/agents/agents-list";

export const metadata: Metadata = { title: "Agents" };

export default function Page() {
  return <AgentsPage />;
}
