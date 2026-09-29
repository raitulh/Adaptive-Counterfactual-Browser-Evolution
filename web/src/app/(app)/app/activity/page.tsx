import type { Metadata } from "next";
import { Suspense } from "react";
import { ActivityLog } from "@/components/activity/activity-log";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  return (
    <Suspense>
      <ActivityLog />
    </Suspense>
  );
}
