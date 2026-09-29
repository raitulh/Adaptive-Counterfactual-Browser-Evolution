import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentDetail } from "@/components/agents/agent-detail";

export const metadata: Metadata = { title: "Agent" };

export default async function Page({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return (
    <Suspense>
      <AgentDetail agentId={agentId} />
    </Suspense>
  );
}
