"use client";

import { PlayIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button, ConfirmDialog, Switch, Tooltip, toast, toastError, type ButtonProps } from "@/components/ui";
import type { AutomationOut } from "@/lib/api";
import { usePermissions } from "@/lib/auth/hooks";
import { dateTime } from "@/lib/format";
import { describeRunError } from "./automation-status";
import { useDeleteAutomation, useRunNow, useUpdateAutomation } from "./hooks";

/** Run now → toast with a link to the created task (or an honest explanation if it didn't start). */
export function useRunNowAction() {
  const router = useRouter();
  const runNow = useRunNow();
  const trigger = (automation: Pick<AutomationOut, "id" | "name">) =>
    runNow.mutate(automation.id, {
      onSuccess: (run) => {
        if (run.status === "failed" || run.status === "skipped") {
          toast.error("The run couldn't start", { description: describeRunError(run.error) ?? "It was not started." });
          return;
        }
        if (!run.task_id && run.next_attempt_at) {
          toast.warning("Run queued for retry", {
            description: `${describeRunError(run.error) ?? "The task couldn't be created yet"}. AgentOS retries at ${dateTime(run.next_attempt_at)}.`,
          });
          return;
        }
        toast.success(run.status === "succeeded" ? "Run finished" : "Run started", {
          description: `${automation.name} — its task is ${run.status === "succeeded" ? "complete" : "executing now"}.`,
          action: run.task_id
            ? { label: "Open task", onClick: () => router.push(`/app/tasks/${run.task_id}`) }
            : undefined,
        });
      },
      onError: (err) => toastError(err, "Couldn't run the automation"),
    });
  return { trigger, isPending: runNow.isPending, pendingId: runNow.isPending ? runNow.variables : undefined };
}

export function RunNowButton({
  automation,
  size = "sm",
  variant = "secondary",
}: {
  automation: Pick<AutomationOut, "id" | "name">;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
}) {
  const { can } = usePermissions();
  const { trigger, isPending } = useRunNowAction();
  const allowed = can("automations:manage") && can("tasks:create");
  return (
    <Tooltip
      content={
        allowed
          ? "Start a run immediately (repeat clicks within the same minute return the same run)."
          : "You need permission to manage automations and create tasks."
      }
    >
      <span>
        <Button
          size={size}
          variant={variant}
          disabled={!allowed}
          loading={isPending}
          onClick={() => trigger(automation)}
        >
          {!isPending && <PlayIcon aria-hidden />} Run now
        </Button>
      </span>
    </Tooltip>
  );
}

/** Enabled toggle backed by PATCH; the switch reflects the server state, not an optimistic guess. */
export function EnabledSwitch({ automation, className }: { automation: AutomationOut; className?: string }) {
  const { can } = usePermissions();
  const update = useUpdateAutomation();
  const allowed = can("automations:manage");
  return (
    <Tooltip
      content={!allowed ? "You need permission to manage automations." : automation.enabled ? "Turn off" : "Turn on"}
    >
      <span className={className}>
        <Switch
          checked={automation.enabled}
          disabled={!allowed || update.isPending}
          aria-label={`${automation.enabled ? "Turn off" : "Turn on"} ${automation.name}`}
          aria-busy={update.isPending || undefined}
          onCheckedChange={(enabled) =>
            update.mutate(
              { id: automation.id, body: { enabled } },
              {
                onSuccess: (a) =>
                  toast.success(a.enabled ? "Automation turned on" : "Automation turned off", { description: a.name }),
                onError: (err) => toastError(err, enabled ? "Couldn't turn it on" : "Couldn't turn it off"),
              },
            )
          }
        />
      </span>
    </Tooltip>
  );
}

export function DeleteAutomationDialog({
  automation,
  open,
  onOpenChange,
  onDeleted,
}: {
  automation: Pick<AutomationOut, "id" | "name">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const remove = useDeleteAutomation();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="danger"
      title={`Delete “${automation.name}”?`}
      description="It stops immediately and no future runs are scheduled. Tasks it already created are kept. This can't be undone."
      confirmLabel="Delete automation"
      confirmText="delete"
      loading={remove.isPending}
      onConfirm={() =>
        remove.mutate(automation.id, {
          onSuccess: () => {
            onOpenChange(false);
            toast.success("Automation deleted", { description: automation.name });
            onDeleted?.();
          },
          onError: (err) => toastError(err, "Couldn't delete the automation"),
        })
      }
    />
  );
}
