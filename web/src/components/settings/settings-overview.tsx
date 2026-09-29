"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, Building2Icon, CodeIcon, MonitorSmartphoneIcon, ShieldIcon, UserIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Avatar, Skeleton, Switch } from "@/components/ui/controls";
import { authApi } from "@/lib/api";
import { useCurrentUser, useOrganization } from "@/lib/auth/hooks";
import { humanize } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { useUiStore } from "@/stores/ui";
import { isSessionActive } from "./sessions-settings";
import { useNow } from "./use-now";
import { zoneOffset } from "./timezone-select";

function OverviewCard({
  href,
  icon,
  title,
  children,
  cta,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  children: ReactNode;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-xl border border-line bg-surface-1 p-5 outline-none transition-colors hover:border-line-strong hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg border border-line-strong bg-surface-2 text-fg-muted [&_svg]:size-4">{icon}</span>
        <h2 className="text-sm font-semibold tracking-tight text-fg">{title}</h2>
      </div>
      <div className="min-h-12 text-[13px] text-fg-muted">{children}</div>
      <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-accent">
        {cta}
        <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}

export function SettingsOverview() {
  const me = useCurrentUser();
  const { organization, organizations } = useOrganization();
  const sessions = useQuery({ queryKey: qk.sessions, queryFn: () => authApi.sessions(), staleTime: 15_000 });
  const developerMode = useUiStore((s) => s.developerMode);
  const setDeveloperMode = useUiStore((s) => s.setDeveloperMode);
  const now = useNow();
  const activeSessions = sessions.data?.filter((s) => isSessionActive(s, now)).length;
  const user = me.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <OverviewCard href="/app/settings/profile" icon={<UserIcon />} title="Profile" cta="Edit profile">
          {user ? (
            <div className="flex items-center gap-3">
              <Avatar name={user.display_name || user.email} className="size-9" />
              <div className="min-w-0">
                <div className="truncate font-medium text-fg">{user.display_name || "No display name"}</div>
                <div className="truncate text-xs">
                  {user.email} · {user.timezone.replace(/_/g, " ")} {zoneOffset(user.timezone)}
                </div>
              </div>
            </div>
          ) : (
            <Skeleton className="h-9 w-56" />
          )}
        </OverviewCard>
        <OverviewCard href="/app/settings/security" icon={<ShieldIcon />} title="Security" cta="Manage security">
          {user ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                Two-step verification
                <Badge tone={user.mfa_enabled ? "success" : "warning"}>{user.mfa_enabled ? "On" : "Off"}</Badge>
              </div>
              <div className="text-xs text-fg-subtle">
                {user.mfa_enabled ? "Sign-ins require an authenticator code." : "Turn it on to protect your account beyond a password."}
              </div>
            </div>
          ) : (
            <Skeleton className="h-9 w-56" />
          )}
        </OverviewCard>
        <OverviewCard href="/app/settings/sessions" icon={<MonitorSmartphoneIcon />} title="Sessions" cta="Review devices">
          {activeSessions === undefined ? (
            <Skeleton className="h-4 w-40" />
          ) : (
            <>
              <span className="text-lg font-semibold tabular-nums text-fg">{activeSessions}</span> active{" "}
              {activeSessions === 1 ? "session" : "sessions"} across your devices.
            </>
          )}
        </OverviewCard>
        <OverviewCard href="/app/settings/organization" icon={<Building2Icon />} title="Organization" cta="Organization settings">
          {organization ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-fg">{organization.name}</span>
                <Badge tone="accent">Active</Badge>
              </div>
              <div className="text-xs text-fg-subtle">
                {humanize(organization.plan)} plan{organization.role ? ` · ${humanize(organization.role)}` : ""}
                {organizations.length > 1 ? ` · member of ${organizations.length} organizations` : ""}
              </div>
            </div>
          ) : (
            <Skeleton className="h-9 w-56" />
          )}
        </OverviewCard>
      </div>

      <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface-1 p-5 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="pref-dev">
        <div className="flex items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface-2 text-fg-muted">
            <CodeIcon className="size-4" aria-hidden />
          </span>
          <div>
            <h2 id="pref-dev" className="text-sm font-semibold tracking-tight text-fg">
              Developer details
            </h2>
            <p className="mt-0.5 max-w-xl text-[13px] text-fg-muted">
              Show identifiers, request ids and raw event data throughout the app. Stored on this device only.
            </p>
          </div>
        </div>
        <Switch checked={developerMode} onCheckedChange={setDeveloperMode} aria-labelledby="pref-dev" />
      </section>
    </div>
  );
}
