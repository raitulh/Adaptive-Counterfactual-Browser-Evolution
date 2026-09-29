import type { Metadata } from "next";
import { CandidateDetail } from "@/components/acbe/candidate-detail";

export const metadata: Metadata = { title: "Strategy candidate · ACBE Lab" };

export default async function CandidatePage({ params }: { params: Promise<{ candidateId: string }> }) {
  const { candidateId } = await params;
  return <CandidateDetail candidateId={candidateId} />;
}
