"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  dashboardNav,
  isNavItemActive,
  settingsNavItem,
  type DashboardNavItem,
} from "@/components/dashboard/nav-items";
import { Logo } from "@/components/ui/logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDashboardUi } from "@/lib/state/dashboard-store";
import { cn } from "@/lib/utils/cn";

export function NavLink({
  item,
  collapsed = false,
  onNavigate,
}: {
  item: DashboardNavItem;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = isNavItemActive(item, pathname);
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13px] transition-colors",
        active
          ? "bg-surface-overlay text-foreground"
          : "text-muted hover:bg-surface-raised hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

export function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {dashboardNav.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          {collapsed ? (
            <span aria-hidden className="mx-auto mb-1 h-px w-5 bg-border" />
          ) : (
            <p className="px-2.5 pb-1 text-[11px] font-medium text-subtle">{group.title}</p>
          )}
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <li key={item.href}>
                <NavLink item={item} collapsed={collapsed} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Collapsible desktop sidebar. Collapse state is persisted (zustand) after mount. */
export function Sidebar() {
  const collapsed = useDashboardUi((state) => state.sidebarCollapsed);
  const toggle = useDashboardUi((state) => state.toggleSidebar);

  useEffect(() => {
    void useDashboardUi.persist.rehydrate();
  }, []);

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-background transition-[width] duration-300 ease-out-expo lg:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center border-b border-border",
          collapsed ? "justify-center" : "px-4",
        )}
      >
        <Link href="/" className="rounded-md" aria-label="RealHuman home">
          <Logo showWordmark={!collapsed} />
        </Link>
      </div>
      <nav
        aria-label="Dashboard"
        className={cn("flex-1 overflow-y-auto py-5", collapsed ? "px-3" : "px-3")}
      >
        <SidebarNav collapsed={collapsed} />
      </nav>
      <div className="flex flex-col gap-1 border-t border-border p-3">
        <NavLink item={settingsNavItem} collapsed={collapsed} />
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className={cn(
            "flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13px] text-subtle transition-colors hover:bg-surface-raised hover:text-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden className="size-4" />
          ) : (
            <PanelLeftClose aria-hidden className="size-4" />
          )}
          {collapsed ? null : "Collapse"}
        </button>
      </div>
    </aside>
  );
}
