import type { Metadata } from "next";
import { SessionsView } from "@/components/dashboard/views/sessions-view";

export const metadata: Metadata = { title: "Sessions" };

export default function SessionsPage() {
  return <SessionsView />;
}
