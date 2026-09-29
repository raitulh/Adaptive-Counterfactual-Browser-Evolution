"use client";

import {
  Building2Icon,
  LayoutGridIcon,
  MonitorSmartphoneIcon,
  ShieldIcon,
  UserIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { useOrganization } from "@/lib/auth/hooks";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

interface SettingsNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

export const SETTINGS_NAV: SettingsNavItem[] = [
  { href: "/app/settings", label: "Overview", icon: LayoutGridIcon, exact: true },
  { href: "/app/settings/profile", label: "Profile", icon: UserIcon },
  { href: "/app/settings/security", label: "Security", icon: ShieldIcon },
  { href: "/app/settings/sessions", label: "Sessions", icon: MonitorSmartphoneIcon },
  { href: "/app/settings/organization", label: "Organization", icon: Building2Icon },
];

function isCurrent(item: SettingsNavItem, pathname: string) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Settings chrome: a persistent sub-navigation (vertical on desktop, scrollable pills on mobile). */
export function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/app/settings";
  const { organization } = useOrganization();
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Account & organization"
        title="Settings"
        description={
          organization ? (
            <>
              Personal settings apply everywhere. Organization settings apply to{" "}
              <span className="font-medium text-fg">{organization.name}</span>
              {organization.role ? <> (you are {humanize(organization.role).toLowerCase()})</> : null}.
            </>
          ) : (
            "Personal settings apply everywhere; organization settings apply to the active organization."
          )
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="Settings sections" className="-mx-4 min-w-0 px-4 lg:mx-0 lg:px-0">
          <ul className="flex gap-1 overflow-x-auto pb-1 lg:sticky lg:top-20 lg:flex-col lg:overflow-visible lg:pb-0">
            {SETTINGS_NAV.map((item) => {
              const active = isCurrent(item, pathname);
              const Icon = item.icon;
              return (
                <li key={item.href} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-9 items-center gap-2.5 rounded-md px-3 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                      active
                        ? "bg-surface-3 text-fg shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]"
                        : "text-fg-muted hover:bg-white/[0.04] hover:text-fg",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", active ? "text-accent" : "text-fg-subtle")} aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </PageContainer>
  );
}

/** A settings card with a header and optional footer, used by every settings sub-page. */
export function SettingsCard({
  title,
  description,
  actions,
  footer,
  children,
  tone = "default",
  className,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  tone?: "default" | "danger";
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={cn(
        "rounded-xl border bg-surface-1",
        tone === "danger" ? "border-danger/30" : "border-line",
        className,
      )}
    >
      <div className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2
            id={id ? `${id}-title` : undefined}
            className={cn("text-sm font-semibold tracking-tight", tone === "danger" ? "text-danger" : "text-fg")}
          >
            {title}
          </h2>
          {description && <div className="mt-1 max-w-2xl text-[13px] leading-relaxed text-fg-muted">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children !== undefined && children !== null ? (
        <div className="px-5 py-4">{children}</div>
      ) : (
        <div className="pb-5" />
      )}
      {footer && (
        <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:items-center sm:justify-end">
          {footer}
        </div>
      )}
    </section>
  );
}
