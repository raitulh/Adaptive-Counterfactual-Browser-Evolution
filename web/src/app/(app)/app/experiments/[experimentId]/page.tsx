import type { Metadata } from "next";
import { ExperimentDetail } from "@/components/experiments/experiment-detail";

export const metadata: Metadata = { title: "Experiment" };

export default async function ExperimentPage({ params }: { params: Promise<{ experimentId: string }> }) {
  const { experimentId } = await params;
  return <ExperimentDetail experimentId={experimentId} />;
}
