"use client";

import { ChevronsLeftIcon, ChevronsRightIcon } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark, AgentCoreMark } from "@/components/brand/logo";
import { Tooltip } from "@/components/ui/tooltip";
import { NAV_SECTIONS, SETTINGS_ITEM, isActive, type NavItem } from "@/config/navigation";
import { usePermissions } from "@/lib/auth/hooks";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { OrgSwitcher } from "./org-switcher";
import { formatCount, usePendingApprovalsCount } from "./use-badges";
import { UserMenu } from "./user-menu";

export function useVisibleNav() {
  const { can, isPlatformAdmin, isLoading } = usePermissions();
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (item.platformAdminOnly) return isPlatformAdmin;
      if (!item.permission) return true;
      return isLoading ? section.id === "main" : can(item.permission);
    }),
  })).filter((s) => s.items.length > 0);
}

function NavLink({ item, collapsed, badge, onNavigate }: { item: NavItem; collapsed: boolean; badge?: string | null; onNavigate?: () => void }) {
  const pathname = usePathname() ?? "";
  const active = isActive(item, pathname);
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50",
        active ? "text-fg" : "text-fg-muted hover:bg-white/[0.04] hover:text-fg",
        collapsed && "justify-center px-0",
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          className="absolute inset-0 rounded-md border border-line-strong bg-white/[0.06]"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
          aria-hidden
        />
      )}
      {active && <span className="absolute -left-3 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" aria-hidden />}
      <Icon className={cn("relative size-4 shrink-0", active ? "text-accent" : "text-fg-subtle group-hover:text-fg-muted")} aria-hidden />
      {!collapsed && <span className="relative truncate">{item.label}</span>}
      {badge && (
        <span
          className={cn(
            "relative ml-auto rounded-full bg-warning/15 px-1.5 text-2xs font-semibold tabular-nums text-warning",
            collapsed && "absolute -right-1 -top-1 ml-0 px-1",
          )}
          aria-label={`${badge} pending`}
        >
          {badge}
        </span>
      )}
    </Link>
  );
  return collapsed ? (
    <Tooltip content={badge ? `${item.label} · ${badge} pending` : item.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

export function SidebarNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const sections = useVisibleNav();
  const approvals = usePendingApprovalsCount();
  const approvalsBadge = formatCount(approvals.data);
  return (
    <nav aria-label="Primary" className="flex flex-col gap-5">
      {sections.map((section) => (
        <div key={section.id} className="flex flex-col gap-0.5">
          {section.label && !collapsed && (
            <div className="px-2.5 pb-1 text-2xs font-medium uppercase tracking-[0.14em] text-fg-subtle">{section.label}</div>
          )}
          {section.label && collapsed && <div className="mx-auto my-1 h-px w-5 bg-line" aria-hidden />}
          {section.items.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              collapsed={collapsed}
              badge={item.badge === "approvals" ? approvalsBadge : null}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface-1/60 transition-[width] duration-300 ease-out lg:flex",
        collapsed ? "w-[68px]" : "w-60",
      )}
    >
      <div className={cn("flex h-14 items-center px-4", collapsed && "justify-center px-0")}>
        <Link href="/app" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/50" aria-label="AgentOS home">
          {collapsed ? <AgentCoreMark /> : <Wordmark />}
        </Link>
      </div>
      <div className={cn("flex-1 overflow-y-auto px-3 py-3", collapsed && "px-2")}>
        <SidebarNav collapsed={collapsed} />
      </div>
      <div className={cn("flex flex-col gap-1 border-t border-line p-3", collapsed && "items-center px-2")}>
        <NavLink item={SETTINGS_ITEM} collapsed={collapsed} />
        <OrgSwitcher collapsed={collapsed} />
        <div className={cn("flex items-center gap-1", collapsed ? "flex-col" : "justify-between")}>
          <UserMenu collapsed={collapsed} />
          <Tooltip content={collapsed ? "Expand sidebar" : "Collapse sidebar"} side="right">
            <button
              type="button"
              onClick={toggle}
              className="rounded-md p-1.5 text-fg-subtle outline-none hover:bg-white/5 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <ChevronsRightIcon className="size-4" /> : <ChevronsLeftIcon className="size-4" />}
            </button>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}
