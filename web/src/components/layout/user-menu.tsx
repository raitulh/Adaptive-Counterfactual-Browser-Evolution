"use client";

import { CodeIcon, LogOutIcon, MonitorSmartphoneIcon, ShieldIcon, UserIcon } from "lucide-react";
import Link from "next/link";
import { Avatar, Switch } from "@/components/ui/controls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth, useCurrentUser } from "@/lib/auth/hooks";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

export function UserMenu({ collapsed = false }: { collapsed?: boolean }) {
  const { logout } = useAuth();
  const me = useCurrentUser();
  const developerMode = useUiStore((s) => s.developerMode);
  const setDeveloperMode = useUiStore((s) => s.setDeveloperMode);
  const name = me.data?.display_name || me.data?.email || "Account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-md p-1 text-left outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-accent/50",
          !collapsed && "flex-1 pr-2",
        )}
        aria-label="Account menu"
      >
        <Avatar name={name} className="size-6" />
        {!collapsed && <span className="truncate text-[13px] text-fg-muted">{name}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-64">
        <DropdownMenuLabel className="tracking-normal normal-case">
          <span className="block truncate text-[13px] font-medium text-fg">{me.data?.display_name || "Signed in"}</span>
          <span className="block truncate text-xs font-normal text-fg-subtle">{me.data?.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/settings/profile">
            <UserIcon /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/settings/security">
            <ShieldIcon /> Security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/settings/sessions">
            <MonitorSmartphoneIcon /> Sessions
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setDeveloperMode(!developerMode);
          }}
        >
          <CodeIcon /> Developer details
          <Switch checked={developerMode} className="pointer-events-none ml-auto" tabIndex={-1} aria-hidden />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem tone="danger" onSelect={() => void logout()}>
          <LogOutIcon /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
