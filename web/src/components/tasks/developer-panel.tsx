"use client";

/** Developer details (developer mode only): ids, sequences, versions, counters, methods, refs, reproducibility. */
import type { TaskDetailView } from "@/lib/api";
import { IdChip, JsonViewer, KeyValue } from "@/components/ui/data-display";
import type { StreamState } from "@/lib/realtime/sse";

export function DeveloperPanel({
  task,
  lastSeq,
  eventCount,
  streamState,
}: {
  task: TaskDetailView;
  lastSeq: number;
  eventCount: number;
  streamState: StreamState;
}) {
  const steps = task.steps;
  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-xl border border-line bg-surface-1 p-4">
        <h3 className="mb-3 text-2xs font-semibold tracking-[0.12em] text-fg-subtle uppercase">Task</h3>
        <KeyValue
          items={[
            ["Task id", <IdChip key="t" id={task.task_id} />],
            [
              "Agent",
              task.agent_id ? (
                <IdChip key="a" id={task.agent_id} />
              ) : (
                <span className="font-mono text-xs">built-in</span>
              ),
            ],
            [
              "Agent version",
              task.agent_version_id ? (
                <IdChip key="v" id={task.agent_version_id} />
              ) : (
                <span className="font-mono text-xs">{String(task.reproducibility.agent ?? "—")}</span>
              ),
            ],
            [
              "Plan version",
              <span key="p" className="font-mono">
                {task.plan_version}
              </span>,
            ],
            [
              "Event seq",
              <span key="s" className="font-mono">
                {lastSeq} ({eventCount} events)
              </span>,
            ],
            [
              "Stream",
              <span key="st" className="font-mono">
                {streamState}
              </span>,
            ],
            [
              "Model calls",
              <span key="m" className="font-mono">
                {task.model_calls}
              </span>,
            ],
            [
              "Tool calls",
              <span key="tc" className="font-mono">
                {task.tool_calls}
              </span>,
            ],
            [
              "Priority",
              <span key="pr" className="font-mono">
                {task.priority}
              </span>,
            ],
            [
              "Failure code",
              <span key="f" className="font-mono">
                {task.failure_code ?? "—"}
              </span>,
            ],
          ]}
        />
      </section>

      <section className="rounded-xl border border-line bg-surface-1">
        <h3 className="px-4 pt-4 text-2xs font-semibold tracking-[0.12em] text-fg-subtle uppercase">Steps</h3>
        <div className="overflow-x-auto p-2">
          <table className="w-full min-w-[40rem] text-left font-mono text-2xs text-fg-muted">
            <thead>
              <tr className="text-fg-subtle">
                <th className="px-2 py-1.5 font-medium">v/#</th>
                <th className="px-2 py-1.5 font-medium">key</th>
                <th className="px-2 py-1.5 font-medium">id</th>
                <th className="px-2 py-1.5 font-medium">tool@version</th>
                <th className="px-2 py-1.5 font-medium">status</th>
                <th className="px-2 py-1.5 font-medium">verification</th>
                <th className="px-2 py-1.5 font-medium">attempts</th>
                <th className="px-2 py-1.5 font-medium">error_class</th>
                <th className="px-2 py-1.5 font-medium">external_ref</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="px-2 py-1.5">
                    {s.plan_version}/{s.position + 1}
                  </td>
                  <td className="px-2 py-1.5 text-fg">{s.step_key}</td>
                  <td className="px-2 py-1.5">
                    <IdChip id={s.id} />
                  </td>
                  <td className="px-2 py-1.5">
                    {s.tool_name}@{s.tool_version}
                  </td>
                  <td className="px-2 py-1.5">{s.status}</td>
                  <td className="px-2 py-1.5">
                    {s.verification_method}:{s.verification_status}
                  </td>
                  <td className="px-2 py-1.5">{s.attempt_count}</td>
                  <td className="px-2 py-1.5">{s.error_class ?? "—"}</td>
                  <td className="max-w-40 truncate px-2 py-1.5">{s.external_ref ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-2xs font-semibold tracking-[0.12em] text-fg-subtle uppercase">Reproducibility</h3>
        <JsonViewer value={task.reproducibility} />
      </section>
      {task.plan && (
        <section>
          <h3 className="mb-2 text-2xs font-semibold tracking-[0.12em] text-fg-subtle uppercase">Stored plan</h3>
          <JsonViewer value={task.plan} />
        </section>
      )}
    </div>
  );
}
