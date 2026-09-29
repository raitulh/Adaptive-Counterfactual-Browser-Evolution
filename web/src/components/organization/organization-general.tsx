"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeftIcon, Building2Icon, CheckIcon, PlusIcon } from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IdChip, KeyValue } from "@/components/ui/data-display";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InlineError } from "@/components/ui/states";
import { toast, toastError } from "@/components/ui/toaster";
import { organizationsApi, type OrganizationOut } from "@/lib/api";
import { useAuth, useOrganization, usePermissions } from "@/lib/auth/hooks";
import { dateOnly, humanize } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { useUiStore } from "@/stores/ui";
import { applyFieldErrors, ruleMessage } from "@/components/settings/form-errors";
import { SettingsCard } from "@/components/settings/settings-layout";

const nameSchema = z.object({ name: z.string().trim().min(1, "Enter a name").max(200, "At most 200 characters") });
type NameValues = z.infer<typeof nameSchema>;

export function OrganizationGeneral({ organization }: { organization: OrganizationOut }) {
  const developerMode = useUiStore((s) => s.developerMode);
  return (
    <div className="flex flex-col gap-6">
      <RenameCard organization={organization} />
      <SettingsCard title="Details" description="Set when the organization was created. Plan and status are managed by AgentOS platform administrators.">
        <KeyValue
          items={[
            ["Plan", <Badge key="p" tone="accent">{humanize(organization.plan)}</Badge>],
            ["Status", <Badge key="s" tone={organization.status === "active" ? "success" : "danger"}>{humanize(organization.status)}</Badge>],
            ["Type", organization.is_personal ? "Personal organization" : "Shared organization"],
            ["Slug", <span key="sl" className="font-mono text-[13px]">{organization.slug}</span>],
            ["Data region", <span key="r" className="font-mono text-[13px]">{organization.data_region}</span>],
            ["Created", dateOnly(organization.created_at)],
            ["Your role", organization.role ? humanize(organization.role) : "—"],
            ...(developerMode ? ([["Organization ID", <IdChip key="id" id={organization.id} />]] as Array<[React.ReactNode, React.ReactNode]>) : []),
          ]}
        />
      </SettingsCard>
      <YourOrganizations />
    </div>
  );
}

function RenameCard({ organization }: { organization: OrganizationOut }) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canManage = can("org:manage");
  const form = useForm<NameValues>({ resolver: zodResolver(nameSchema), defaultValues: { name: organization.name } });
  const { register, handleSubmit, formState, reset, setError } = form;
  React.useEffect(() => {
    if (!formState.isDirty) reset({ name: organization.name });
  }, [organization.name, formState.isDirty, reset]);

  const rename = useMutation({
    mutationFn: (v: NameValues) => organizationsApi.updateCurrent({ name: v.name }),
    onSuccess: (org) => {
      queryClient.setQueryData(qk.organization.current, org);
      void queryClient.invalidateQueries({ queryKey: qk.myOrganizations });
      reset({ name: org.name });
      toast.success("Organization renamed");
    },
    onError: (err) => {
      if (!applyFieldErrors(err, setError, ["name"])) setError("root", { type: "server", message: ruleMessage(err) });
    },
  });

  return (
    <form onSubmit={handleSubmit((v) => rename.mutate(v))} noValidate>
      <SettingsCard
        title="Name"
        description={canManage ? "Shown to members in the organization switcher and in notifications." : "Only owners and admins can rename the organization."}
        footer={
          canManage ? (
            <Button type="submit" variant="primary" loading={rename.isPending} disabled={!formState.isDirty}>
              Save name
            </Button>
          ) : undefined
        }
      >
        <Field label="Organization name" error={formState.errors.name?.message} className="max-w-md">
          {(ids) => <Input {...ids} {...register("name")} disabled={!canManage} autoComplete="organization" />}
        </Field>
        {formState.errors.root?.message ? <InlineError className="mt-3" error={new Error(formState.errors.root.message)} /> : null}
      </SettingsCard>
    </form>
  );
}

function YourOrganizations() {
  const { organizations, tenantId, switchOrganization } = useOrganization();
  const [switching, setSwitching] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  async function switchTo(org: OrganizationOut) {
    setSwitching(org.id);
    try {
      await switchOrganization(org.id);
      toast.success(`Switched to ${org.name}`);
    } catch (err) {
      toastError(err, "Couldn't switch organization");
      setSwitching(null);
    }
  }

  return (
    <SettingsCard
      title="Your organizations"
      description="Everything you see in AgentOS — tasks, agents, approvals, memory — belongs to the active organization. Switching reloads the app for that organization."
      actions={
        <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
          <PlusIcon /> New organization
        </Button>
      }
    >
      <ul className="flex flex-col divide-y divide-line">
        {organizations.map((org) => {
          const active = org.id === tenantId;
          return (
            <li key={org.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-xs font-bold uppercase text-accent">{org.name.slice(0, 1)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-fg">{org.name}</span>
                  {active && (
                    <Badge tone="accent">
                      <CheckIcon className="size-3" aria-hidden /> Active
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-fg-subtle">
                  {humanize(org.plan)} plan{org.role ? ` · ${humanize(org.role)}` : ""}
                  {org.is_personal ? " · Personal" : ""}
                </div>
              </div>
              {!active && (
                <Button variant="outline" size="sm" loading={switching === org.id} disabled={switching !== null} onClick={() => void switchTo(org)}>
                  <ArrowRightLeftIcon /> Switch
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <CreateOrganizationDialog open={createOpen} onOpenChange={setCreateOpen} />
    </SettingsCard>
  );
}

export function CreateOrganizationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { switchOrganization } = useAuth();
  const [created, setCreated] = React.useState<OrganizationOut | null>(null);
  const [switching, setSwitching] = React.useState(false);
  const form = useForm<NameValues>({ resolver: zodResolver(nameSchema), defaultValues: { name: "" } });
  const { register, handleSubmit, formState, reset, setError } = form;

  const create = useMutation({
    mutationFn: (v: NameValues) => organizationsApi.create({ name: v.name }),
    onSuccess: (org) => {
      setCreated(org);
      void queryClient.invalidateQueries({ queryKey: qk.myOrganizations });
    },
    onError: (err) => applyFieldErrors(err, setError, ["name"]),
  });

  function close(next: boolean) {
    if (!next) {
      reset({ name: "" });
      create.reset();
      setCreated(null);
      setSwitching(false);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="sm">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Building2Icon className="size-4 text-success" aria-hidden /> {created.name} is ready
              </DialogTitle>
              <DialogDescription>
                You are its owner. It starts on the {humanize(created.plan)} plan with the default execution policy. Switch to it now to invite members and
                set it up.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => close(false)}>
                Stay here
              </Button>
              <Button
                variant="primary"
                loading={switching}
                onClick={async () => {
                  setSwitching(true);
                  try {
                    await switchOrganization(created.id);
                    toast.success(`Switched to ${created.name}`);
                    close(false);
                  } catch (err) {
                    toastError(err, "Couldn't switch organization");
                    setSwitching(false);
                  }
                }}
              >
                <ArrowRightLeftIcon /> Switch to {created.name}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit((v) => create.mutate(v))} noValidate>
            <DialogHeader>
              <DialogTitle>New organization</DialogTitle>
              <DialogDescription>A separate workspace with its own members, policy, agents, data and usage. You become its owner.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field label="Name" error={formState.errors.name?.message}>
                {(ids) => <Input {...ids} autoFocus placeholder="Acme Research" autoComplete="organization" {...register("name")} />}
              </Field>
              {create.error && !formState.errors.name ? <InlineError className="mt-3" error={create.error} /> : null}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={create.isPending}>
                Create organization
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
