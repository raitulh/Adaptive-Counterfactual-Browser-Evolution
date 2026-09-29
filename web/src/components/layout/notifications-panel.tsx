"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellIcon, CheckCheckIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/controls";
import { RelativeTime } from "@/components/ui/data-display";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/drawer";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { toast, toastError } from "@/components/ui/toaster";
import { notificationsApi, type NotificationOut } from "@/lib/api";
import { qk } from "@/lib/query/keys";
import { useCursorQuery } from "@/lib/query/pagination";
import { onUserStreamMessage } from "@/lib/realtime/use-user-stream";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

const TONE: Record<string, string> = {
  approval_required: "bg-warning",
  input_required: "bg-warning",
  task_completed: "bg-success",
  task_failed: "bg-danger",
  automation_failed: "bg-danger",
  connection_expired: "bg-recover",
  security_alert: "bg-danger",
};

function linkFor(n: NotificationOut): string | null {
  const data = n.data as Record<string, unknown>;
  if (typeof data.task_id === "string") return `/app/tasks/${data.task_id}`;
  if (n.event_type === "connection_expired") return "/app/integrations";
  if (n.event_type === "automation_failed") return "/app/automations";
  return null;
}

export function NotificationsPanel() {
  const open = useUiStore((s) => s.notificationsOpen);
  const setOpen = useUiStore((s) => s.setNotificationsOpen);
  const queryClient = useQueryClient();

  const list = useCursorQuery<NotificationOut>({
    queryKey: qk.notifications.list({ limit: 30 }),
    fetchPage: (cursor, signal) => notificationsApi.list({ cursor, limit: 30 }, { signal }),
    enabled: open,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.notifications.all });
  const markRead = useMutation({ mutationFn: (id: string) => notificationsApi.markRead(id), onSuccess: invalidate, onError: (e) => toastError(e) });
  const markAll = useMutation({ mutationFn: () => notificationsApi.markAllRead(), onSuccess: invalidate, onError: (e) => toastError(e) });

  // Surface important realtime notifications as toasts (the drawer remains the durable record).
  useEffect(
    () =>
      onUserStreamMessage((m) => {
        if (m.type !== "NOTIFICATION_CREATED") return;
        if (m.event === "approval_required" || m.event === "input_required" || m.event === "task_failed" || m.event === "connection_expired") {
          toast(m.title, { action: { label: "View", onClick: () => useUiStore.getState().setNotificationsOpen(true) } });
        }
      }),
    [],
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="max-w-md">
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-4 pr-12">
          <div>
            <SheetTitle className="text-base font-semibold tracking-tight">Notifications</SheetTitle>
            <SheetDescription className="text-xs text-fg-subtle">Approvals, questions and results from your agents.</SheetDescription>
          </div>
          <Button size="xs" variant="ghost" onClick={() => markAll.mutate()} loading={markAll.isPending}>
            <CheckCheckIcon /> Mark all read
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto" aria-live="polite">
          {list.isLoading && (
            <div className="space-y-3 p-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          )}
          {list.error && <ErrorState error={list.error} onRetry={() => list.refetch()} compact />}
          {!list.isLoading && !list.error && list.items.length === 0 && (
            <EmptyState icon={<BellIcon />} title="You're all caught up" description="When an agent needs you or finishes something important, it shows up here." />
          )}
          <ul className="divide-y divide-line">
            {list.items.map((n) => {
              const href = linkFor(n);
              const unread = !n.read_at;
              const body = (
                <div className="flex gap-3 px-5 py-3.5">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", unread ? (TONE[n.event_type] ?? "bg-accent") : "bg-transparent")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-[13px] leading-snug", unread ? "font-medium text-fg" : "text-fg-muted")}>{n.title}</p>
                    {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-fg-subtle">{n.body}</p>}
                    <RelativeTime value={n.created_at} className="mt-1 block text-2xs text-fg-subtle" />
                  </div>
                  {unread && <span className="sr-only">Unread</span>}
                </div>
              );
              return (
                <li key={n.id}>
                  {href ? (
                    <Link
                      href={href}
                      className="block outline-none transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.05]"
                      onClick={() => {
                        if (unread) markRead.mutate(n.id);
                        setOpen(false);
                      }}
                    >
                      {body}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="block w-full text-left outline-none hover:bg-white/[0.03] focus-visible:bg-white/[0.05]"
                      onClick={() => unread && markRead.mutate(n.id)}
                    >
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {list.hasNextPage && (
            <div className="flex justify-center p-3">
              <Button size="sm" variant="ghost" onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>
                Load more
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
