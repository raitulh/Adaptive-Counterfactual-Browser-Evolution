import {
  ActivityIcon,
  BlocksIcon,
  BotIcon,
  BrainCircuitIcon,
  CreditCardIcon,
  DnaIcon,
  FlaskConicalIcon,
  FolderOpenIcon,
  GaugeIcon,
  ListChecksIcon,
  PlugIcon,
  SearchIcon,
  SettingsIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SplitIcon,
  WorkflowIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import type { PermissionCode } from "@/lib/api";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown only when the user has this permission (UX only; the backend still authorizes). */
  permission?: PermissionCode;
  platformAdminOnly?: boolean;
  badge?: "approvals" | "notifications";
  /** Match nested routes (e.g. /app/tasks/123) as active. */
  matchPrefix?: boolean;
  keywords?: string[];
}

export interface NavSection {
  id: "main" | "advanced" | "admin";
  label?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "main",
    items: [
      { href: "/app", label: "Command Center", icon: SparklesIcon, keywords: ["home", "new task", "goal"] },
      { href: "/app/tasks", label: "Tasks", icon: ListChecksIcon, matchPrefix: true, permission: "tasks:read" },
      { href: "/app/approvals", label: "Approvals", icon: ShieldCheckIcon, badge: "approvals", matchPrefix: true },
      { href: "/app/agents", label: "Agents", icon: BotIcon, matchPrefix: true, permission: "agents:read" },
      { href: "/app/automations", label: "Automations", icon: WorkflowIcon, matchPrefix: true },
      { href: "/app/integrations", label: "Integrations", icon: PlugIcon, matchPrefix: true, keywords: ["google", "gmail", "calendar", "drive"] },
      { href: "/app/memory", label: "Memory", icon: BrainCircuitIcon, matchPrefix: true, permission: "memory:read" },
      { href: "/app/search", label: "Search", icon: SearchIcon, matchPrefix: true, keywords: ["web", "documents", "research"] },
      { href: "/app/files", label: "Files", icon: FolderOpenIcon, matchPrefix: true, permission: "files:read" },
      { href: "/app/activity", label: "Activity", icon: ActivityIcon, matchPrefix: true, permission: "audit:read", keywords: ["audit", "log"] },
      { href: "/app/usage", label: "Usage", icon: GaugeIcon, matchPrefix: true, permission: "usage:read" },
      { href: "/app/billing", label: "Billing", icon: CreditCardIcon, matchPrefix: true, keywords: ["plan", "pricing"] },
    ],
  },
  {
    id: "advanced",
    label: "Advanced",
    items: [
      { href: "/app/tools", label: "Tools", icon: WrenchIcon, matchPrefix: true, permission: "tools:read", keywords: ["policies", "rules"] },
      { href: "/app/mcp", label: "MCP", icon: BlocksIcon, matchPrefix: true, permission: "mcp:manage", keywords: ["servers"] },
      { href: "/app/evaluations", label: "Evaluations", icon: FlaskConicalIcon, matchPrefix: true, permission: "experiments:manage" },
      { href: "/app/experiments", label: "Experiments", icon: SplitIcon, matchPrefix: true, permission: "experiments:manage" },
      { href: "/app/acbe", label: "ACBE Lab", icon: DnaIcon, matchPrefix: true, permission: "experiments:manage", keywords: ["self-improvement", "strategy"] },
    ],
  },
  {
    id: "admin",
    label: "Platform",
    items: [{ href: "/app/admin", label: "Admin", icon: ShieldAlertIcon, matchPrefix: true, platformAdminOnly: true }],
  },
];

export const SETTINGS_ITEM: NavItem = { href: "/app/settings", label: "Settings", icon: SettingsIcon, matchPrefix: true };

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/app") return pathname === "/app";
  return item.matchPrefix ? pathname === item.href || pathname.startsWith(`${item.href}/`) : pathname === item.href;
}
