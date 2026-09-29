import type { Metadata } from "next";
import { ServerDetail } from "@/components/mcp/server-detail";

export const metadata: Metadata = { title: "MCP server" };

export default async function Page({ params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params;
  return <ServerDetail serverId={serverId} />;
}
