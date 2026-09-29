import type { Metadata } from "next";
import { McpPage } from "@/components/mcp/mcp-page";

export const metadata: Metadata = { title: "MCP Center" };

export default function Page() {
  return <McpPage />;
}
