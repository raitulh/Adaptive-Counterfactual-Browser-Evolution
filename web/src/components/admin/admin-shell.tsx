"use client";

import {
  Building2Icon,
  FlagIcon,
  GaugeIcon,
  ListRestartIcon,
  SearchCodeIcon,
  ServerCogIcon,
  ShieldAlertIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/controls";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { PermissionDenied } from "@/components/ui/states";
import { usePermissions } from "@/lib/auth/hooks";
import { cn } from "@/lib/utils";

const TABS: Array<{ href: string; label: string; icon: LucideIcon; exact?: boolean }> = [
  { href: "/app/admin", label: "System", icon: ServerCogIcon, exact: true },
  { href: "/app/admin/users", label: "Users", icon: UsersIcon },
  { href: "/app/admin/organizations", label: "Organizations", icon: Building2Icon },
  { href: "/app/admin/security", label: "Security events", icon: ShieldAlertIcon },
  { href: "/app/admin/jobs", label: "Dead jobs", icon: ListRestartIcon },
  { href: "/app/admin/usage", label: "Usage", icon: GaugeIcon },
  { href: "/app/admin/flags", label: "Feature flags", icon: FlagIcon },
  { href: "/app/admin/tasks", label: "Task lookup", icon: SearchCodeIcon },
];

/**
 * Platform administration chrome. The UI gate is UX only — every admin endpoint requires
 * `is_platform_admin` on the backend, and every cross-tenant read is audited there.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/app/admin";
  const { isPlatformAdmin, isLoading } = usePermissions();

  if (isLoading) {
    return (
      <PageContainer width="wide">
        <Skeleton className="h-16 w-72" />
        <Skeleton className="mt-6 h-10 w-full" />
        <Skeleton className="mt-6 h-72 w-full rounded-xl" />
      </PageContainer>
    );
  }
  if (!isPlatformAdmin) {
    return (
      <PageContainer>
        <PageHeader title="Platform admin" />
        <div className="rounded-xl border border-line bg-surface-1">
          <PermissionDenied />
        </div>
        <p className="mt-3 text-center text-xs text-fg-subtle">
          The admin console is only available to AgentOS platform administrators.
        </p>
      </PageContainer>
    );
  }
  return (
    <PageContainer width="wide">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 text-verify">
            <ShieldAlertIcon className="size-3.5" aria-hidden /> Platform console · every action is audited
          </span>
        }
        title="Admin"
        description="Operate the AgentOS platform across all organizations: health, accounts, plans, security events, failed jobs and feature flags."
      />
      <nav aria-label="Admin sections" className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {TABS.map((t) => {
            const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
            const Icon = t.icon;
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "-mb-px flex h-10 items-center gap-2 border-b-2 px-3 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                    active ? "border-verify text-fg" : "border-transparent text-fg-muted hover:text-fg",
                  )}
                >
                  <Icon className={cn("size-4", active ? "text-verify" : "text-fg-subtle")} aria-hidden />
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {children}
    </PageContainer>
  );
}

export function AdminSection({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-fg">{title}</h2>
          {description && <p className="mt-0.5 max-w-3xl text-[13px] text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
