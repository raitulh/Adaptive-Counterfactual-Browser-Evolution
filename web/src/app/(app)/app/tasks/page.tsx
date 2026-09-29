import type { Metadata } from "next";
import { Suspense } from "react";
import { TasksList } from "@/components/tasks/tasks-list";

export const metadata: Metadata = { title: "Tasks" };

export default function TasksPage() {
  // The status filter lives in the URL (useSearchParams needs a Suspense boundary).
  return (
    <Suspense fallback={null}>
      <TasksList />
    </Suspense>
  );
}
