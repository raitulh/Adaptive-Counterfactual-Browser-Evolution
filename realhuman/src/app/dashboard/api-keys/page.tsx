import type { Metadata } from "next";
import { ApiKeysView } from "@/components/dashboard/views/api-keys-view";

export const metadata: Metadata = { title: "API Keys" };

export default function ApiKeysPage() {
  return <ApiKeysView />;
}
