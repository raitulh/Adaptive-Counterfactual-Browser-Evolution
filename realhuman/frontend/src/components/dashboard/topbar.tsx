"use client";

import { LogOut, Menu } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { settingsNavItem } from "@/components/dashboard/nav-items";
import { NavLink, SidebarNav } from "@/components/dashboard/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuthSession, useLogout } from "@/hooks/use-dashboard-data";
import { apiMode } from "@/lib/api/mode";

export function Topbar() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const router = useRouter();
  const session = useAuthSession();
  const logout = useLogout();
  const workspace = session.data?.workspace ?? (apiMode === "mock" ? "Demo workspace" : null);

  async function handleLogout() {
    try {
      await logout.mutateAsync();
    } catch {
      // Leaving is still the right outcome if the session was already gone.
    }
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-(--z-sticky) flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-xl sm:px-6">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="-ml-1 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu aria-hidden />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" aria-describedby={undefined} className="max-w-72">
          <SheetTitle className="sr-only">Dashboard navigation</SheetTitle>
          <div className="flex h-14 items-center border-b border-border px-4">
            <Logo />
          </div>
          <nav aria-label="Dashboard" className="flex-1 overflow-y-auto px-3 py-5">
            <SidebarNav onNavigate={close} />
          </nav>
          <div className="border-t border-border p-3">
            <NavLink item={settingsNavItem} onNavigate={close} />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden
          className="inline-flex size-6 items-center justify-center rounded-md bg-surface-overlay font-mono text-[11px] text-muted uppercase"
        >
          {workspace?.charAt(0) ?? ""}
        </span>
        {workspace ? (
          <span className="truncate text-sm font-medium">{workspace}</span>
        ) : (
          <span aria-hidden className="h-4 w-28 animate-pulse rounded bg-surface-overlay" />
        )}
        <Badge
          tone={apiMode === "mock" ? "warning" : "accent"}
          size="sm"
          className="hidden sm:inline-flex"
        >
          {apiMode === "mock" ? "Mock data" : "Live"}
        </Badge>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
          <Link href="/">View site</Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleLogout()}
          disabled={logout.isPending}
        >
          <LogOut aria-hidden />
          <span className="hidden sm:inline">Log out</span>
          <span className="sr-only sm:hidden">Log out</span>
        </Button>
      </div>
    </header>
  );
}
