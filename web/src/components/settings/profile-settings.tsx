"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgeCheckIcon, MailWarningIcon, Trash2Icon } from "lucide-react";
import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/controls";
import { KeyValue } from "@/components/ui/data-display";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorState, InlineError } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { usersApi, type MeOut, type UserUpdate } from "@/lib/api";
import { useAuth, useCurrentUser } from "@/lib/auth/hooks";
import { dateOnly, dateTime } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { applyFieldErrors } from "./form-errors";
import { LOCALE_PATTERN, localeLabel, localeOptions } from "./locale";
import { SettingsCard } from "./settings-layout";
import { TimezoneSelect } from "./timezone-select";

const profileSchema = z.object({
  display_name: z.string().trim().max(200, "At most 200 characters"),
  timezone: z.string().min(1, "Choose a time zone"),
  locale: z.string().regex(LOCALE_PATTERN, "Use a language tag like en or en-US"),
});
type ProfileValues = z.infer<typeof profileSchema>;

function toValues(me: MeOut): ProfileValues {
  return { display_name: me.display_name ?? "", timezone: me.timezone, locale: me.locale };
}

export function ProfileSettings() {
  const me = useCurrentUser();
  if (me.error) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  if (!me.data) return <ProfileSkeleton />;
  return (
    <div className="flex flex-col gap-6">
      <ProfileForm me={me.data} />
      <AccountDetails me={me.data} />
      <DeleteAccount me={me.data} />
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <div className="rounded-xl border border-line bg-surface-1 p-5">
        <Skeleton className="h-4 w-32" />
        <div className="mt-6 grid gap-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="grid gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full max-w-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProfileForm({ me }: { me: MeOut }) {
  const queryClient = useQueryClient();
  const form = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: toValues(me) });
  const { register, control, handleSubmit, formState, reset, setError } = form;

  // Keep the form in sync when the profile changes elsewhere (another tab, the backend), unless edited.
  React.useEffect(() => {
    if (!formState.isDirty) reset(toValues(me));
  }, [me, formState.isDirty, reset]);

  const save = useMutation({
    mutationFn: (values: ProfileValues) => {
      const body: UserUpdate = {};
      if (values.display_name !== (me.display_name ?? "")) body.display_name = values.display_name;
      if (values.timezone !== me.timezone) body.timezone = values.timezone;
      if (values.locale !== me.locale) body.locale = values.locale;
      return usersApi.update(body);
    },
    onSuccess: (user) => {
      queryClient.setQueryData<MeOut>(qk.me, (prev) => (prev ? { ...prev, ...user } : prev));
      void queryClient.invalidateQueries({ queryKey: qk.me });
      reset({ display_name: user.display_name ?? "", timezone: user.timezone, locale: user.locale });
      toast.success("Profile saved");
    },
    onError: (err) => {
      applyFieldErrors(err, setError, ["display_name", "timezone", "locale"]);
    },
  });

  const locales = localeOptions(me.locale);

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
      <SettingsCard
        title="Profile"
        description="How you appear to teammates, and the time zone AgentOS uses to interpret dates like “tomorrow at 2 PM” in your goals."
        footer={
          <>
            <Button type="button" variant="ghost" disabled={!formState.isDirty || save.isPending} onClick={() => reset(toValues(me))}>
              Discard
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!formState.isDirty}>
              Save profile
            </Button>
          </>
        }
      >
        <div className="grid max-w-xl gap-5">
          <Field label="Display name" error={formState.errors.display_name?.message} description="Shown in the app and to members of your organizations.">
            {(ids) => <Input {...ids} {...register("display_name")} autoComplete="name" placeholder="Your name" />}
          </Field>
          <Field label="Email" description="Your sign-in address. It can't be changed here.">
            {(ids) => (
              <div className="flex flex-wrap items-center gap-2">
                <Input {...ids} value={me.email} readOnly aria-readonly className="max-w-sm cursor-default text-fg-muted" />
                {me.email_verified ? (
                  <Badge tone="success">
                    <BadgeCheckIcon className="size-3" aria-hidden /> Verified
                  </Badge>
                ) : (
                  <Badge tone="neutral" title="The address has not been verified by an identity provider.">
                    <MailWarningIcon className="size-3" aria-hidden /> Not verified
                  </Badge>
                )}
              </div>
            )}
          </Field>
          <Field label="Time zone" error={formState.errors.timezone?.message} description="Used for scheduling, automations and how times are interpreted in your goals.">
            {(ids) => (
              <Controller
                control={control}
                name="timezone"
                render={({ field }) => <TimezoneSelect {...ids} value={field.value} onChange={(z) => field.onChange(z)} />}
              />
            )}
          </Field>
          <Field label="Language & region" error={formState.errors.locale?.message} description="Preferred language and regional format for your account.">
            {(ids) => (
              <Controller
                control={control}
                name="locale"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger {...ids} className="max-w-sm">
                      <SelectValue placeholder="Choose a locale" />
                    </SelectTrigger>
                    <SelectContent>
                      {locales.map((tag) => (
                        <SelectItem key={tag} value={tag}>
                          {localeLabel(tag)} <span className="ml-1 font-mono text-2xs text-fg-subtle">{tag}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </Field>
          {save.error && !Object.keys(formState.errors).length ? <InlineError error={save.error} /> : null}
        </div>
      </SettingsCard>
    </form>
  );
}

function AccountDetails({ me }: { me: MeOut }) {
  return (
    <SettingsCard title="Account" description="Read-only details about your account.">
      <KeyValue
        items={[
          ["Status", <Badge key="s" tone={me.status === "active" ? "success" : "warning"}>{me.status === "active" ? "Active" : me.status}</Badge>],
          ["Member since", dateOnly(me.created_at)],
          ["Last sign-in", dateTime(me.last_login_at)],
          ["Two-step verification", me.mfa_enabled ? "On" : "Off"],
          ...(me.is_platform_admin ? ([["Platform role", <Badge key="p" tone="verify">Platform administrator</Badge>]] as Array<[React.ReactNode, React.ReactNode]>) : []),
        ]}
      />
    </SettingsCard>
  );
}

function DeleteAccount({ me }: { me: MeOut }) {
  const { logout } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const passwordId = React.useId();
  const remove = useMutation({
    mutationFn: () => usersApi.deleteAccount({ confirm: true, password: password || null }),
    onSuccess: async () => {
      setOpen(false);
      toast.success("Account deletion requested", {
        description: "You have been signed out everywhere. Your data is being removed.",
      });
      await logout();
    },
  });

  return (
    <SettingsCard
      tone="danger"
      title="Delete account"
      description="Permanently delete your AgentOS account. This can't be undone."
      actions={
        <Button variant="danger-outline" size="sm" onClick={() => setOpen(true)}>
          <Trash2Icon /> Delete account…
        </Button>
      }
    >
      <ul className="grid gap-1.5 text-[13px] leading-relaxed text-fg-muted">
        <li>• You are signed out of every device immediately and can no longer sign in.</li>
        <li>• Your memories, files, tasks and connected integrations are removed in the background; integrations are revoked at the provider.</li>
        <li>• Personal organizations are deleted. Shared organizations keep working for their other members.</li>
        <li>• Audit records are retained as required by your organization&apos;s retention policy.</li>
      </ul>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setPassword("");
            remove.reset();
          }
        }}
        tone="danger"
        title="Delete your account?"
        description="All sessions are revoked now and your data is purged asynchronously. This is permanent."
        confirmLabel="Delete my account"
        confirmText={me.email}
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={passwordId} className="text-xs text-fg-muted">
            Current password <span className="text-fg-subtle">(required if you sign in with a password)</span>
          </label>
          <Input id={passwordId} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {remove.error ? (
            <InlineError
              className="mt-2"
              error={
                (remove.error as { code?: string }).code === "invalid_credentials"
                  ? new Error("The password is incorrect.")
                  : remove.error
              }
            />
          ) : null}
        </div>
      </ConfirmDialog>
    </SettingsCard>
  );
}
