"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserMinusIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Avatar } from "@/components/ui/controls";
import { RelativeTime } from "@/components/ui/data-display";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, InlineError } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { billingApi, organizationsApi, systemRoleValues, type MemberOut, type SystemRole } from "@/lib/api";
import { useCurrentUser, usePermissions } from "@/lib/auth/hooks";
import { humanize } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { applyFieldErrors, ruleMessage } from "@/components/settings/form-errors";
import { SettingsCard } from "@/components/settings/settings-layout";

/** What each system role can do (mirrors backend app/organizations/rbac.py ROLE_PERMISSIONS). */
export const ROLE_SUMMARY: Record<SystemRole, string> = {
  owner: "Everything, including billing and granting ownership.",
  admin: "Manage members, policy, tools, MCP, audit and experiments.",
  member: "Run tasks, agents, automations, memory, files and search.",
  viewer: "Read-only access to tasks, agents, memory, tools and files.",
};

const ROLE_TONE: Record<SystemRole, "accent" | "verify" | "neutral" | "info"> = { owner: "verify", admin: "accent", member: "info", viewer: "neutral" };

function isSystemRole(role: string): role is SystemRole {
  return (systemRoleValues as readonly string[]).includes(role);
}

function RoleBadge({ role }: { role: string }) {
  return <Badge tone={isSystemRole(role) ? ROLE_TONE[role] : "neutral"}>{humanize(role)}</Badge>;
}

const addSchema = z.object({
  email: z.email("Enter a valid e-mail address"),
  role: z.enum(systemRoleValues as unknown as [SystemRole, ...SystemRole[]]),
});
type AddValues = z.infer<typeof addSchema>;

export function MembersPanel() {
  const queryClient = useQueryClient();
  const me = useCurrentUser();
  const { can, role: myRole } = usePermissions();
  const canManage = can("members:manage");
  const members = useQuery({ queryKey: qk.organization.members, queryFn: ({ signal }) => organizationsApi.members({ signal }) });
  const entitlements = useQuery({ queryKey: qk.billing.entitlements, queryFn: ({ signal }) => billingApi.entitlements({ signal }), staleTime: 5 * 60_000 });
  const [removing, setRemoving] = React.useState<MemberOut | null>(null);
  const [ownerGrant, setOwnerGrant] = React.useState<MemberOut | null>(null);
  const [changing, setChanging] = React.useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.organization.members });

  const changeRole = useMutation({
    mutationFn: ({ member, role }: { member: MemberOut; role: SystemRole }) => organizationsApi.updateMemberRole(member.id, { role }),
    onMutate: ({ member }) => setChanging(member.id),
    onSuccess: (_d, { member, role }) => {
      toast.success(`${member.display_name || member.email} is now ${humanize(role).toLowerCase()}`);
      setOwnerGrant(null);
    },
    onError: (err) => toast.error("Couldn't change the role", { description: ruleMessage(err) }),
    onSettled: () => {
      setChanging(null);
      void invalidate();
      void queryClient.invalidateQueries({ queryKey: qk.me });
    },
  });

  const remove = useMutation({
    mutationFn: (member: MemberOut) => organizationsApi.removeMember(member.id),
    onSuccess: (_d, member) => {
      toast.success(`Removed ${member.display_name || member.email}`, { description: "Their sessions in this organization were signed out." });
      setRemoving(null);
    },
    onSettled: () => void invalidate(),
  });

  const list = members.data ?? [];
  const maxMembers = entitlements.data?.plan.max_members;

  const columns: Column<MemberOut>[] = [
    {
      id: "member",
      header: "Member",
      cell: (m) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={m.display_name || m.email} className="size-8" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium text-fg">{m.display_name || m.email.split("@")[0]}</span>
              {m.user_id === me.data?.id && <Badge tone="accent">You</Badge>}
              {m.status !== "active" && <Badge tone="warning">{humanize(m.status)}</Badge>}
            </div>
            <div className="truncate text-xs text-fg-subtle">{m.email}</div>
          </div>
        </div>
      ),
    },
    {
      id: "role",
      header: "Role",
      className: "w-44",
      cell: (m) =>
        canManage && isSystemRole(m.role) ? (
          <Select
            value={m.role}
            disabled={changing === m.id}
            onValueChange={(value) => {
              const role = value as SystemRole;
              if (role === m.role) return;
              if (role === "owner") setOwnerGrant(m);
              else changeRole.mutate({ member: m, role });
            }}
          >
            <SelectTrigger className="h-8 w-36" aria-label={`Role of ${m.email}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {systemRoleValues.map((r) => (
                <SelectItem key={r} value={r}>
                  {humanize(r)}
                  {r === "owner" && myRole !== "owner" ? <span className="ml-1.5 text-2xs text-fg-subtle">(owners only)</span> : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <RoleBadge role={m.role} />
        ),
    },
    { id: "joined", header: "Joined", hideBelow: "md", cell: (m) => <RelativeTime value={m.created_at} className="text-fg-muted" /> },
    ...(canManage
      ? [
          {
            id: "actions",
            header: <span className="sr-only">Actions</span>,
            className: "w-24 text-right",
            cell: (m: MemberOut) => (
              <Button variant="ghost" size="icon-sm" onClick={() => setRemoving(m)} aria-label={`Remove ${m.email}`} className="text-fg-subtle hover:text-danger">
                <UserMinusIcon />
              </Button>
            ),
          } satisfies Column<MemberOut>,
        ]
      : []),
  ];

  const self = removing?.user_id === me.data?.id;

  return (
    <div className="flex flex-col gap-6">
      {canManage && <AddMemberCard existing={list} myRole={myRole} onAdded={() => void invalidate()} />}
      <SettingsCard
        title={
          <span className="flex items-center gap-2">
            Members
            {members.data && (
              <Badge tone="neutral" className="tabular-nums">
                {list.length}
                {maxMembers ? ` / ${maxMembers}` : ""}
              </Badge>
            )}
          </span>
        }
        description={
          <>
            Everyone with access to this organization and their role.
            {maxMembers ? ` Your ${entitlements.data?.plan.display_name} plan includes up to ${maxMembers.toLocaleString()} ${maxMembers === 1 ? "member" : "members"}.` : ""}
            {!canManage && " Only owners and admins can change membership."}
          </>
        }
      >
        <DataTable
          className="-mx-5 -my-4 rounded-none border-0 bg-transparent"
          caption="Organization members"
          columns={columns}
          rows={list}
          rowKey={(m) => m.id}
          isLoading={members.isLoading}
          error={members.error}
          onRetry={() => void members.refetch()}
          empty={<EmptyState size="sm" icon={<UsersIcon />} title="No members yet" description="Add teammates by the e-mail address they signed up with." />}
        />
        <dl className="mt-6 grid gap-2 border-t border-line pt-4 text-xs sm:grid-cols-2">
          {systemRoleValues.map((r) => (
            <div key={r} className="flex gap-2">
              <dt className="w-16 shrink-0">
                <RoleBadge role={r} />
              </dt>
              <dd className="text-fg-subtle">{ROLE_SUMMARY[r]}</dd>
            </div>
          ))}
        </dl>
      </SettingsCard>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRemoving(null);
            remove.reset();
          }
        }}
        tone="danger"
        title={self ? "Leave this organization?" : `Remove ${removing?.display_name || removing?.email}?`}
        description={
          self
            ? "You will lose access to this organization immediately and your sessions in it are signed out."
            : "They lose access immediately and their sessions in this organization are signed out. Their tasks and data stay in the organization."
        }
        confirmLabel={self ? "Leave organization" : "Remove member"}
        loading={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing);
        }}
      >
        {remove.error ? <InlineError error={new Error(ruleMessage(remove.error))} /> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={ownerGrant !== null}
        onOpenChange={(o) => !o && setOwnerGrant(null)}
        title={`Make ${ownerGrant?.display_name || ownerGrant?.email} an owner?`}
        description="Owners have full control, including billing, membership and granting ownership to others."
        confirmLabel="Grant owner role"
        loading={changeRole.isPending}
        onConfirm={() => {
          if (ownerGrant) changeRole.mutate({ member: ownerGrant, role: "owner" });
        }}
      />
    </div>
  );
}

function AddMemberCard({ existing, myRole, onAdded }: { existing: MemberOut[]; myRole: string | null; onAdded: () => void }) {
  const form = useForm<AddValues>({ resolver: zodResolver(addSchema), defaultValues: { email: "", role: "member" } });
  const { register, control, handleSubmit, formState, reset, setError } = form;
  const add = useMutation({
    mutationFn: (v: AddValues) => organizationsApi.addMember({ email: v.email.trim(), role: v.role }),
    onSuccess: (m) => {
      toast.success(`Added ${m.display_name || m.email} as ${humanize(m.role).toLowerCase()}`);
      reset({ email: "", role: "member" });
      onAdded();
    },
    onError: (err) => {
      if (!applyFieldErrors(err, setError, ["email", "role"])) setError("root", { type: "server", message: ruleMessage(err) });
    },
  });

  return (
    <form
      onSubmit={handleSubmit((v) => {
        if (existing.some((m) => m.email.toLowerCase() === v.email.trim().toLowerCase())) {
          setError("email", { type: "validate", message: "Already a member of this organization" });
          return;
        }
        add.mutate(v);
      })}
      noValidate
    >
      <SettingsCard
        title="Add a member"
        description="Add someone who already has an AgentOS account, using the e-mail address they signed up with. They get access immediately."
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Field label="E-mail address" error={formState.errors.email?.message} className="flex-1">
            {(ids) => <Input {...ids} type="email" autoComplete="off" placeholder="teammate@company.com" {...register("email")} />}
          </Field>
          <Field label="Role" error={formState.errors.role?.message} className="sm:w-40">
            {(ids) => (
              <Controller
                control={control}
                name="role"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger {...ids}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {systemRoleValues.map((r) => (
                        <SelectItem key={r} value={r}>
                          {humanize(r)}
                          {r === "owner" && myRole !== "owner" ? <span className="ml-1.5 text-2xs text-fg-subtle">(owners only)</span> : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={add.isPending} className="sm:mt-[26px]">
            <UserPlusIcon /> Add member
          </Button>
        </div>
        {formState.errors.root?.message ? <InlineError className="mt-3" error={new Error(formState.errors.root.message)} /> : null}
      </SettingsCard>
    </form>
  );
}
