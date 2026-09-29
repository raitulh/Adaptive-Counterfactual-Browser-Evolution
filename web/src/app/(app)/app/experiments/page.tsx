import type { Metadata } from "next";
import { ExperimentsLab } from "@/components/experiments/experiments-lab";

export const metadata: Metadata = { title: "Experiments" };

export default function ExperimentsPage() {
  return <ExperimentsLab />;
}
