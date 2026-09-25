import {
  Activity,
  BookOpen,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  ScrollText,
  Settings,
  Waypoints,
  Webhook,
} from "lucide-react";

export interface DashboardNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
}

export const dashboardNav: readonly { title: string; items: readonly DashboardNavItem[] }[] = [
  {
    title: "Verification",
    items: [
      { label: "Overview", href: "/dashboard", icon: LayoutDashboard, exact: true },
      { label: "Sessions", href: "/dashboard/sessions", icon: Activity },
      { label: "Signals", href: "/dashboard/signals", icon: Waypoints },
    ],
  },
  {
    title: "Developers",
    items: [
      { label: "API Keys", href: "/dashboard/api-keys", icon: KeyRound },
      { label: "Webhooks", href: "/dashboard/webhooks", icon: Webhook },
      { label: "Logs", href: "/dashboard/logs", icon: ScrollText },
      { label: "Docs", href: "/docs", icon: BookOpen },
    ],
  },
];

export const settingsNavItem: DashboardNavItem = {
  label: "Settings",
  href: "/dashboard/settings",
  icon: Settings,
};

export function isNavItemActive(item: DashboardNavItem, pathname: string): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
