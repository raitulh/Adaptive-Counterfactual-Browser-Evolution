import type { Metadata } from "next";
import { CreateAgentPage } from "@/components/agents/create-agent";

export const metadata: Metadata = { title: "New agent" };

export default function Page() {
  return <CreateAgentPage />;
}
