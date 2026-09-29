"use client";

import { useQueryClient } from "@tanstack/react-query";
import { BanIcon, CheckCircle2Icon, MoreHorizontalIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast, toastError } from "@/components/ui/toaster";
import type { McpServerOut, McpSyncResult } from "@/lib/api";
import { isApiError } from "@/lib/api/errors";
import { summarizeSync } from "./mcp-review";
import { useApproveMcpServer, useDeleteMcpServer, useDisableMcpServer, useSyncMcpServer } from "./queries";
import { describeUnsafeUrl } from "./register-server-dialog";

export const lastSyncKey = (serverId: string) => ["mcp", "server", serverId, "last-sync"] as const;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function canSync(server: Pick<McpServerOut, "status">) {
  return server.status === "approved" || server.status === "error";
}

export function canApprove(server: Pick<McpServerOut, "status">) {
  return server.status !== "approved";
}

function errorDetail(err: unknown): string | undefined {
  if (isApiError(err) && err.code === "unsafe_url") return `${err.message}. ${describeUnsafeUrl(err.message)}`;
  return undefined;
}

/** Approve / sync / disable / delete with the confirmations each needs. */
export function useServerActions(server: McpServerOut, opts: { onDeleted?: () => void } = {}) {
  const qc = useQueryClient();
  const approve = useApproveMcpServer();
  const disable = useDisableMcpServer();
  const remove = useDeleteMcpServer();
  const sync = useSyncMcpServer();
  const [dialog, setDialog] = React.useState<null | "approve" | "disable" | "delete">(null);

  const runSync = async (): Promise<McpSyncResult | null> => {
    try {
      const result = await sync.mutateAsync(server.id);
      qc.setQueryData(lastSyncKey(server.id), { result, at: Date.now() });
      const s = summarizeSync(result);
      const message =
        s.changed === 0 ? "No changes." : `${s.changed} ${s.changed === 1 ? "change" : "changes"} detected.`;
      if (s.suspicious)
        toast.warning(`Synced ${server.name} — review required`, {
          description: `${message} Some tools changed since approval or were rejected.`,
        });
      else toast.success(`Synced ${server.name}`, { description: message });
      return result;
    } catch (err) {
      const detail = errorDetail(err);
      if (detail) toast.error(`Sync of ${server.name} blocked by the egress policy`, { description: detail });
      else toastError(err, `Sync of ${server.name} failed`);
      return null;
    }
  };

  const dialogs = (
    <>
      <ConfirmDialog
        open={dialog === "approve"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Approve ${server.name}?`}
        description={
          <>
            AgentOS re-checks <span className="font-mono text-fg">{hostOf(server.url)}</span> against the egress policy,
            then allows syncing its tools. Every tool stays disabled until you review and enable it individually.
          </>
        }
        confirmLabel="Approve server"
        loading={approve.isPending}
        onConfirm={async () => {
          try {
            await approve.mutateAsync(server.id);
            toast.success(`${server.name} approved`, { description: "Sync it to discover its tools." });
            setDialog(null);
          } catch (err) {
            const detail = errorDetail(err);
            if (detail) toast.error("Approval blocked by the egress policy", { description: detail });
            else toastError(err, "Approval failed");
          }
        }}
      />
      <ConfirmDialog
        open={dialog === "disable"}
        onOpenChange={(o) => !o && setDialog(null)}
        tone="danger"
        title={`Disable ${server.name}?`}
        description="All of its tools become unavailable to agents immediately, including in running tasks at their next call. Tool approvals are kept: approving the server again restores them."
        confirmLabel="Disable server"
        loading={disable.isPending}
        onConfirm={async () => {
          try {
            await disable.mutateAsync(server.id);
            toast.success(`${server.name} disabled`);
            setDialog(null);
          } catch (err) {
            toastError(err, "Couldn't disable the server");
          }
        }}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        tone="danger"
        title={`Delete ${server.name}?`}
        description="Deletes the server registration, its encrypted credential and every tool approval. Re-registering starts the review from scratch. This cannot be undone."
        confirmText={server.name}
        confirmLabel="Delete server"
        loading={remove.isPending}
        onConfirm={async () => {
          try {
            await remove.mutateAsync(server.id);
            toast.success(`${server.name} deleted`);
            setDialog(null);
            opts.onDeleted?.();
          } catch (err) {
            toastError(err, "Couldn't delete the server");
          }
        }}
      />
    </>
  );

  return { approve, disable, remove, sync, runSync, openDialog: setDialog, dialogs };
}

/** Contextual primary action + overflow menu. */
export function ServerActionBar({
  server,
  size = "sm",
  onDeleted,
  onSynced,
}: {
  server: McpServerOut;
  size?: "sm" | "xs";
  onDeleted?: () => void;
  onSynced?: (r: McpSyncResult) => void;
}) {
  const a = useServerActions(server, { onDeleted });
  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {canApprove(server) ? (
        <Button size={size} variant="primary" onClick={() => a.openDialog("approve")}>
          <CheckCircle2Icon /> Approve
        </Button>
      ) : null}
      {canSync(server) && (
        <Button
          size={size}
          variant="secondary"
          loading={a.sync.isPending}
          onClick={async () => {
            const r = await a.runSync();
            if (r) onSynced?.(r);
          }}
        >
          <RefreshCwIcon /> Sync now
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size={size === "xs" ? "icon-xs" : "icon-sm"}
            aria-label={`More actions for ${server.name}`}
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {server.status !== "disabled" && (
            <DropdownMenuItem onSelect={() => a.openDialog("disable")}>
              <BanIcon /> Disable server
            </DropdownMenuItem>
          )}
          {server.status !== "disabled" && <DropdownMenuSeparator />}
          <DropdownMenuItem tone="danger" onSelect={() => a.openDialog("delete")}>
            <Trash2Icon /> Delete server
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {a.dialogs}
    </div>
  );
}
