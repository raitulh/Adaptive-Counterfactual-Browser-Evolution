import type { Metadata } from "next";
import { WebhooksView } from "@/components/dashboard/views/webhooks-view";

export const metadata: Metadata = { title: "Webhooks" };

export default function WebhooksPage() {
  return <WebhooksView />;
}
