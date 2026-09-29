import type { Metadata } from "next";
import { RunDetail } from "@/components/evaluations/run-detail";

export const metadata: Metadata = { title: "Evaluation run" };

export default async function EvaluationRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <RunDetail runId={runId} />;
}
