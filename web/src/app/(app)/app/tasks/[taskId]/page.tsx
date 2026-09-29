import type { Metadata } from "next";
import { TaskDetail } from "@/components/tasks/task-detail";

export const metadata: Metadata = { title: "Task" };

export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return <TaskDetail key={taskId} taskId={taskId} />;
}
