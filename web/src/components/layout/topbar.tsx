"use client";

import { BellIcon, CommandIcon, MenuIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { AgentCoreMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/controls";
import { Tooltip } from "@/components/ui/tooltip";
import { useRealtimeStore } from "@/lib/realtime/use-user-stream";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { formatCount, useUnreadNotificationsCount } from "./use-badges";

function RealtimeIndicator() {
  const state = useRealtimeStore((s) => s.userStream);
  const live = state === "open";
  const label = live ? "Live updates connected" : state === "reconnecting" || state === "connecting" ? "Reconnecting live updates…" : "Live updates offline — data refreshes on navigation";
  return (
    <Tooltip content={label}>
      <span className="hidden items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-2xs text-fg-subtle sm:inline-flex" role="status" aria-label={label}>
        <span className={cn("size-1.5 rounded-full", live ? "bg-success" : state === "reconnecting" || state === "connecting" ? "bg-warning motion-safe:animate-signal" : "bg-fg-subtle")} />
        {live ? "Live" : state === "reconnecting" || state === "connecting" ? "Connecting" : "Offline"}
      </span>
    </Tooltip>
  );
}

export function Topbar() {
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);
  const setNotificationsOpen = useUiStore((s) => s.setNotificationsOpen);
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);
  const unread = formatCount(useUnreadNotificationsCount().data);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-bg/80 px-3 backdrop-blur-md sm:px-5">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">
        <MenuIcon />
      </Button>
      <Link href="/app" className="rounded-md lg:hidden" aria-label="AgentOS home">
        <AgentCoreMark />
      </Link>

      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        className="ml-1 flex h-8 w-full max-w-md items-center gap-2 rounded-md border border-line bg-surface-1 px-2.5 text-[13px] text-fg-subtle outline-none transition-colors hover:border-line-strong hover:text-fg-muted focus-visible:ring-2 focus-visible:ring-accent/50"
        aria-label="Open command palette"
      >
        <SearchIcon className="size-3.5" aria-hidden />
        <span className="flex-1 truncate text-left">Search, jump to, or run a command…</span>
        <span className="hidden items-center gap-0.5 sm:flex" aria-hidden>
          <Kbd>
            <CommandIcon className="size-2.5" />
          </Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <RealtimeIndicator />
        <Tooltip content={unread ? `${unread} unread notifications` : "Notifications"}>
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative"
            onClick={() => setNotificationsOpen(true)}
            aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          >
            <BellIcon />
            {unread && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-fg-on-accent">
                {unread}
              </span>
            )}
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
