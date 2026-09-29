"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2Icon, PencilIcon, SearchIcon } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/controls";
import { IdChip, RelativeTime } from "@/components/ui/data-display";
import { DataTable, type Column } from "@/components/ui/data-table";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, InlineError } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { adminApi, billingApi, type AdminOrgOut, type OrgPlanUpdate, type PlanOut } from "@/lib/api";
import { useOrganization } from "@/lib/auth/hooks";
import { humanize } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { AdminSection } from "./admin-shell";

export function useAdminOrganizations() {
  return useQuery({
    queryKey: qk.admin.organizations,
    queryFn: ({ signal }) => adminApi.organizations({ limit: 200 }, { signal }),
    staleTime: 30_000,
  });
}

export function AdminOrganizations() {
  const developerMode = useUiStore((s) => s.developerMode);
  const { tenantId } = useOrganization();
  const orgs = useAdminOrganizations();
  const plans = useQuery({
    queryKey: qk.billing.plans,
    queryFn: ({ signal }) => billingApi.plans({ signal }),
    staleTime: 10 * 60_000,
  });
  const [filter, setFilter] = React.useState("");
  const [target, setTarget] = React.useState<AdminOrgOut | null>(null);
  const planName = (name: string) => plans.data?.find((p) => p.name === name)?.display_name ?? humanize(name);
  const f = filter.trim().toLowerCase();
  const rows = (orgs.data ?? []).filter(
    (o) => !f || o.name.toLowerCase().includes(f) || o.slug.includes(f) || o.id.startsWith(f),
  );

  const columns: Column<AdminOrgOut>[] = [
    {
      id: "org",
      header: "Organization",
      cell: (o) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-fg">{o.name}</span>
            {o.id === tenantId && <Badge tone="accent">Your active org</Badge>}
          </div>
          <div className="font-mono text-2xs text-fg-subtle">{o.slug}</div>
          {developerMode && <IdChip id={o.id} className="mt-1" />}
        </div>
      ),
    },
    {
      id: "plan",
      header: "Plan",
      cell: (o) => (
        <Badge tone="accent" variant="outline">
          {planName(o.plan)}
        </Badge>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (o) => <Badge tone={o.status === "active" ? "success" : "danger"}>{humanize(o.status)}</Badge>,
    },
    {
      id: "region",
      header: "Region",
      hideBelow: "md",
      cell: (o) => <span className="font-mono text-xs text-fg-muted">{o.data_region}</span>,
    },
    {
      id: "created",
      header: "Created",
      hideBelow: "lg",
      cell: (o) => <RelativeTime value={o.created_at} className="text-fg-muted" />,
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "text-right",
      cell: (o) => (
        <Button variant="outline" size="xs" onClick={() => setTarget(o)} disabled={!plans.data}>
          <PencilIcon /> Plan & status
        </Button>
      ),
    },
  ];

  return (
    <AdminSection
      title="Organizations"
      description="Plans are assigned here — there is no self-serve checkout. Suspending an organization blocks access for all of its members."
      actions={
        <div className="relative w-full sm:w-64">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden
          />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name or slug"
            className="h-8 pl-8"
            aria-label="Filter organizations"
            type="search"
          />
        </div>
      }
    >
      <DataTable
        caption="Organizations"
        columns={columns}
        rows={rows}
        rowKey={(o) => o.id}
        isLoading={orgs.isLoading}
        error={orgs.error}
        onRetry={() => void orgs.refetch()}
        empty={
          <EmptyState
            size="sm"
            icon={<Building2Icon />}
            title={f ? "No organizations match" : "No organizations yet"}
          />
        }
      />
      {orgs.data && orgs.data.length >= 200 && (
        <p className="text-xs text-fg-subtle">Showing the 200 most recently created organizations.</p>
      )}
      {plans.data && <PlanDialog org={target} plans={plans.data} onClose={() => setTarget(null)} />}
    </AdminSection>
  );
}

function PlanDialog({ org, plans, onClose }: { org: AdminOrgOut | null; plans: PlanOut[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [plan, setPlan] = React.useState<string>("");
  const [status, setStatus] = React.useState<"active" | "suspended">("active");
  const [loadedFor, setLoadedFor] = React.useState<string | null>(null);
  if (org && loadedFor !== org.id) {
    setLoadedFor(org.id);
    setPlan(org.plan);
    setStatus(org.status === "suspended" ? "suspended" : "active");
  }
  const changed =
    org !== null && (plan !== org.plan || status !== (org.status === "suspended" ? "suspended" : "active"));
  const suspending = status === "suspended" && org?.status !== "suspended";

  const update = useMutation({
    mutationFn: () => {
      const body: OrgPlanUpdate = { plan, status };
      return adminApi.updateOrganization(org!.id, body);
    },
    onSuccess: (o) => {
      toast.success(`${o.name} updated`, {
        description: `${plans.find((p) => p.name === o.plan)?.display_name ?? o.plan} plan · ${humanize(o.status)}`,
      });
      void queryClient.invalidateQueries({ queryKey: qk.admin.organizations });
      void queryClient.invalidateQueries({ queryKey: qk.billing.entitlements });
      void queryClient.invalidateQueries({ queryKey: qk.organization.current });
      void queryClient.invalidateQueries({ queryKey: qk.myOrganizations });
      setLoadedFor(null);
      onClose();
    },
  });

  return (
    <Dialog
      open={org !== null}
      onOpenChange={(o) => {
        if (!o && !update.isPending) {
          update.reset();
          setLoadedFor(null);
          onClose();
        }
      }}
    >
      <DialogContent size="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (changed) update.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Plan & status · {org?.name}</DialogTitle>
            <DialogDescription>
              Plan changes take effect immediately: quotas, limits and features follow the new plan.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-5">
            <Field label="Plan">
              {(ids) => (
                <Select value={plan} onValueChange={setPlan}>
                  <SelectTrigger {...ids}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {plans.map((p) => (
                      <SelectItem key={p.name} value={p.name}>
                        {p.display_name}
                        {p.name === org?.plan ? " (current)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <fieldset>
              <legend className="mb-2 text-[13px] font-medium text-fg">Status</legend>
              <RadioGroup
                value={status}
                onValueChange={(v) => setStatus(v as "active" | "suspended")}
                className="grid gap-2 sm:grid-cols-2"
              >
                {(
                  [
                    ["active", "Active", "Members can sign in and run tasks."],
                    ["suspended", "Suspended", "Members lose access to this organization."],
                  ] as const
                ).map(([value, title, desc]) => (
                  <label
                    key={value}
                    className={cn(
                      "flex cursor-pointer gap-3 rounded-lg border p-3",
                      status === value
                        ? value === "suspended"
                          ? "border-danger/50 bg-danger/[0.06]"
                          : "border-accent/50 bg-accent/[0.06]"
                        : "border-line",
                    )}
                  >
                    <RadioGroupItem value={value} className="mt-0.5" />
                    <span>
                      <span className="block text-[13px] font-medium text-fg">{title}</span>
                      <span className="block text-xs text-fg-subtle">{desc}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </fieldset>
            {suspending && (
              <p
                role="alert"
                className="rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2 text-[13px] text-danger"
              >
                Suspending {org?.name} blocks every member from using it until it is reactivated.
              </p>
            )}
            {update.error ? <InlineError error={update.error} /> : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={update.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={suspending ? "danger" : "primary"}
              loading={update.isPending}
              disabled={!changed}
            >
              {suspending ? "Suspend organization" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
