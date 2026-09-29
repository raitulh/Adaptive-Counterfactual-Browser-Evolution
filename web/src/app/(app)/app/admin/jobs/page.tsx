import type { Metadata } from "next";
import { AdminDeadJobs } from "@/components/admin/admin-dead-jobs";

export const metadata: Metadata = { title: "Dead jobs" };

export default function AdminJobsPage() {
  return <AdminDeadJobs />;
}
