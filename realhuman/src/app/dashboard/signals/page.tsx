import type { Metadata } from "next";
import { SignalsView } from "@/components/dashboard/views/signals-view";

export const metadata: Metadata = { title: "Signals" };

export default function SignalsPage() {
  return <SignalsView />;
}
