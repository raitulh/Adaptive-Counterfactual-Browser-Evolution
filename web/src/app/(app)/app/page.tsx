import type { Metadata } from "next";
import { CommandCenter } from "@/components/command-center/command-center";

export const metadata: Metadata = { title: "Command Center" };

export default function CommandCenterPage() {
  return <CommandCenter />;
}
