import type { Metadata } from "next";
import { Suspense } from "react";
import { EvaluationsLab } from "@/components/evaluations/evaluations-lab";

export const metadata: Metadata = { title: "Evaluations" };

export default function EvaluationsPage() {
  return (
    <Suspense>
      <EvaluationsLab />
    </Suspense>
  );
}
