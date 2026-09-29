"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2Icon, ScrollTextIcon, SlidersHorizontalIcon, UsersIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/controls";
import { ErrorState } from "@/components/ui/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { organizationsApi } from "@/lib/api";
import { humanize } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { MembersPanel } from "./members-panel";
import { OrganizationGeneral } from "./organization-general";
import { PolicyEditor } from "./policy-editor";

const TABS = ["general", "members", "policy"] as const;
type Tab = (typeof TABS)[number];

export function OrganizationSettings() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "general";
  const org = useQuery({ queryKey: qk.organization.current, queryFn: ({ signal }) => organizationsApi.current({ signal }), staleTime: 60_000 });

  if (org.error) return <ErrorState error={org.error} onRetry={() => void org.refetch()} />;

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-label="Active organization"
        className="relative overflow-hidden rounded-xl border border-accent/25 bg-gradient-to-br from-accent/[0.07] via-surface-1 to-surface-1 px-5 py-4"
      >
        {org.data ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/12 text-lg font-bold uppercase text-accent">
              {org.data.name.slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-2xs font-medium uppercase tracking-[0.14em] text-accent">Active organization</div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-semibold tracking-tight text-fg">{org.data.name}</h2>
                {org.data.is_personal && <Badge tone="neutral">Personal</Badge>}
                {org.data.status !== "active" && <Badge tone="danger">{humanize(org.data.status)}</Badge>}
              </div>
              <p className="text-xs text-fg-muted">
                {humanize(org.data.plan)} plan · you are {org.data.role ? humanize(org.data.role).toLowerCase() : "a member"} · changes here apply to
                everyone in this organization
              </p>
            </div>
            <Building2Icon className="pointer-events-none absolute -right-4 -top-4 size-28 text-accent/[0.05]" aria-hidden />
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Skeleton className="size-11 rounded-xl" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-5 w-48" />
            </div>
          </div>
        )}
      </section>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = new URLSearchParams(params.toString());
          if (v === "general") next.delete("tab");
          else next.set("tab", v);
          const qs = next.toString();
          router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        }}
      >
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="general">
            <SlidersHorizontalIcon /> General
          </TabsTrigger>
          <TabsTrigger value="members">
            <UsersIcon /> Members
          </TabsTrigger>
          <TabsTrigger value="policy">
            <ScrollTextIcon /> Policy
          </TabsTrigger>
        </TabsList>
        <TabsContent value="general">{org.data ? <OrganizationGeneral organization={org.data} /> : <Skeleton className="h-64 w-full rounded-xl" />}</TabsContent>
        <TabsContent value="members">
          <MembersPanel />
        </TabsContent>
        <TabsContent value="policy">
          <PolicyEditor />
        </TabsContent>
      </Tabs>
    </div>
  );
}
