"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  BanIcon,
  GlobeIcon,
  HourglassIcon,
  LockIcon,
  MailIcon,
  ShieldAlertIcon,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton, Switch } from "@/components/ui/controls";
import { JsonViewer } from "@/components/ui/data-display";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorState, InlineError } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { billingApi, organizationsApi, type PolicyOut } from "@/lib/api";
import { usePermissions } from "@/lib/auth/hooks";
import { qk } from "@/lib/query/keys";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import {
  diffPolicy,
  type PolicyChange,
  formToPolicy,
  MAX_CONCURRENT_MAX,
  MAX_CONCURRENT_MIN,
  policyToForm,
  validatePolicyForm,
  type PolicyFormValues,
  type TtlUnit,
} from "./policy-form";
import { TagInput } from "./tag-input";

const resolver: Resolver<PolicyFormValues> = async (values) => {
  const errors = validatePolicyForm(values);
  const entries = Object.entries(errors);
  if (entries.length === 0) return { values, errors: {} };
  return {
    values: {},
    errors: Object.fromEntries(entries.map(([k, message]) => [k, { type: "validate", message }])),
  };
};

export function PolicyEditor() {
  const policy = useQuery({ queryKey: qk.organization.policy, queryFn: ({ signal }) => organizationsApi.policy({ signal }) });
  if (policy.error) return <ErrorState error={policy.error} onRetry={() => void policy.refetch()} />;
  if (!policy.data) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-line bg-surface-1 p-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-3 h-3 w-full max-w-lg" />
            <Skeleton className="mt-5 h-9 w-full" />
          </div>
        ))}
      </div>
    );
  }
  return <PolicyForm data={policy.data} />;
}

function PolicySection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface-1">
      <div className="flex gap-3 border-b border-line px-5 py-4">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface-2 text-fg-muted">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-fg">{title}</h3>
          <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-fg-muted">{description}</p>
        </div>
      </div>
      <div className="grid gap-5 px-5 py-5">{children}</div>
    </section>
  );
}

function ToggleRow({
  id,
  title,
  description,
  checked,
  onChange,
  disabled,
  danger,
}: {
  id: string;
  title: string;
  description: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="flex items-center gap-2 text-[13px] font-medium text-fg">
          {title}
          <Badge tone={checked ? (danger ? "warning" : "success") : "neutral"}>{checked ? "Allowed with approval" : "Blocked"}</Badge>
        </label>
        <p className="mt-1 text-xs leading-relaxed text-fg-subtle">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} className="mt-0.5" />
    </div>
  );
}

function PolicyForm({ data }: { data: PolicyOut }) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const developerMode = useUiStore((s) => s.developerMode);
  const canEdit = can("org:manage");
  const entitlements = useQuery({ queryKey: qk.billing.entitlements, queryFn: ({ signal }) => billingApi.entitlements({ signal }), staleTime: 5 * 60_000 });
  const [baseVersion, setBaseVersion] = React.useState(data.policy_version);
  const [review, setReview] = React.useState(false);
  const [pending, setPending] = React.useState<PolicyChange[]>([]);

  const form = useForm<PolicyFormValues>({ resolver, defaultValues: policyToForm(data.policy) });
  const { control, register, handleSubmit, formState, reset, getValues } = form;
  const dirty = formState.isDirty;

  // Pick up server changes when nothing is being edited; otherwise warn about a concurrent edit.
  React.useEffect(() => {
    if (!dirty) reset(policyToForm(data.policy));
  }, [data, dirty, reset]);
  if (!dirty && baseVersion !== data.policy_version) setBaseVersion(data.policy_version);
  const changedElsewhere = dirty && data.policy_version !== baseVersion;

  const save = useMutation({
    mutationFn: () => organizationsApi.updatePolicy(formToPolicy(getValues(), data.policy)),
    onSuccess: (out) => {
      queryClient.setQueryData(qk.organization.policy, out);
      reset(policyToForm(out.policy));
      setBaseVersion(out.policy_version);
      setReview(false);
      toast.success(`Policy saved as version ${out.policy_version}`, { description: "New tasks use it immediately." });
    },
  });

  const planConcurrency = entitlements.data?.plan.max_concurrent_tasks;
  const ttlCustom = useWatch({ control, name: "approval_ttl_custom" });
  const concurrencyCustom = useWatch({ control, name: "max_concurrent_custom" });
  const readOnly = !canEdit;

  return (
    <form
      onSubmit={handleSubmit((values) => {
        setPending(diffPolicy(data.policy, formToPolicy(values, data.policy)));
        save.reset();
        setReview(true);
      })}
      noValidate
      className="flex flex-col gap-5 pb-4"
    >
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-fg">Execution policy</h2>
            <Badge tone="info" variant="outline" className="font-mono">
              v{data.policy_version}
            </Badge>
          </div>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-fg-muted">
            Guardrails every agent in this organization runs under. They are enforced by the permission engine on every tool call, on top of
            built-in safety rules — a policy can make agents stricter, never bypass approvals for risky actions.
          </p>
        </div>
      </div>
      {readOnly && (
        <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/8 px-4 py-3 text-[13px] text-info" role="note">
          <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          You can view this policy. Changing it requires the <span className="font-mono">org:manage</span> permission (owners and admins).
        </div>
      )}
      {changedElsewhere && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/8 px-4 py-3 text-[13px] text-warning" role="alert">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          Someone saved version {data.policy_version} while you were editing (you started from v{baseVersion}). Saving replaces the whole policy with
          your version.
        </div>
      )}

      <PolicySection
        icon={BanIcon}
        title="Tool access"
        description={
          <>
            Tool names or glob patterns such as <code className="font-mono text-fg">gmail.send</code>, <code className="font-mono text-fg">browser.*</code> or{" "}
            <code className="font-mono text-fg">calendar.*_event</code>. Blocked tools are never run; listed approval tools always pause for a person first.
          </>
        }
      >
        <Field label="Blocked tools" description="Agents can't use these at all, for anyone in the organization." error={formState.errors.blocked_tools?.message}>
          {(ids) => (
            <Controller
              control={control}
              name="blocked_tools"
              render={({ field }) => <TagInput {...ids} kind="tool-pattern" tone="danger" value={field.value} onChange={field.onChange} disabled={readOnly} placeholder="e.g. browser.*" />}
            />
          )}
        </Field>
        <Field
          label="Always require approval"
          description="These tools need an explicit approval every time, even when they would normally run on their own."
          error={formState.errors.always_require_approval?.message}
        >
          {(ids) => (
            <Controller
              control={control}
              name="always_require_approval"
              render={({ field }) => <TagInput {...ids} kind="tool-pattern" tone="warning" value={field.value} onChange={field.onChange} disabled={readOnly} placeholder="e.g. gmail.create_draft" />}
            />
          )}
        </Field>
      </PolicySection>

      <PolicySection
        icon={ShieldAlertIcon}
        title="High-impact actions"
        description="Tools that delete data or move money are disabled by default. Allowing them never removes the approval step — each use still waits for a person."
      >
        <Controller
          control={control}
          name="allow_destructive_actions"
          render={({ field }) => (
            <ToggleRow
              id="policy-destructive"
              title="Destructive actions"
              description="Deleting or overwriting data (e.g. deleting files or events). When blocked, agents plan around them or stop."
              checked={field.value}
              onChange={field.onChange}
              disabled={readOnly}
              danger
            />
          )}
        />
        <Controller
          control={control}
          name="allow_financial_actions"
          render={({ field }) => (
            <ToggleRow
              id="policy-financial"
              title="Financial actions"
              description="Actions that commit spend or move money. When blocked, these tools are denied for every agent."
              checked={field.value}
              onChange={field.onChange}
              disabled={readOnly}
              danger
            />
          )}
        />
      </PolicySection>

      <PolicySection
        icon={MailIcon}
        title="E-mail"
        description="Messages and invitations to recipients outside these domains are treated as high risk and always need approval. Leave empty to treat every recipient as external."
      >
        <Field label="Internal e-mail domains" error={formState.errors.internal_email_domains?.message} description="Exact domains, e.g. example.com (subdomains must be listed separately).">
          {(ids) => (
            <Controller
              control={control}
              name="internal_email_domains"
              render={({ field }) => <TagInput {...ids} kind="domain" tone="success" value={field.value} onChange={field.onChange} disabled={readOnly} placeholder="e.g. northwind.com" />}
            />
          )}
        </Field>
      </PolicySection>

      <PolicySection
        icon={GlobeIcon}
        title="Browser & web access"
        description={
          <>
            Where the browser agent and web search may go. <code className="font-mono text-fg">example.com</code> covers the domain and its subdomains;{" "}
            <code className="font-mono text-fg">*.example.com</code> covers subdomains only. These add to the deployment&apos;s own egress rules, and private
            network addresses stay blocked.
          </>
        }
      >
        <Field
          label="Allowed domains"
          description="If set, the browser may only visit these domains (and only where the deployment allows them too). Empty = no organization allowlist."
          error={formState.errors.browser_allowed_domains?.message}
        >
          {(ids) => (
            <Controller
              control={control}
              name="browser_allowed_domains"
              render={({ field }) => <TagInput {...ids} kind="domain-pattern" tone="success" value={field.value} onChange={field.onChange} disabled={readOnly} placeholder="e.g. docs.example.com" />}
            />
          )}
        </Field>
        <Field label="Denied domains" description="Never visited, regardless of the allowlist." error={formState.errors.browser_denied_domains?.message}>
          {(ids) => (
            <Controller
              control={control}
              name="browser_denied_domains"
              render={({ field }) => <TagInput {...ids} kind="domain-pattern" tone="danger" value={field.value} onChange={field.onChange} disabled={readOnly} placeholder="e.g. *.social.example" />}
            />
          )}
        </Field>
      </PolicySection>

      <PolicySection icon={HourglassIcon} title="Approvals & limits" description="How long approval requests stay open, and how much work each person can run at once.">
        <div className="grid gap-3">
          <Controller
            control={control}
            name="approval_ttl_custom"
            render={({ field }) => (
              <div className="flex items-start justify-between gap-4">
                <div>
                  <label htmlFor="policy-ttl-custom" className="text-[13px] font-medium text-fg">
                    Custom approval expiry
                  </label>
                  <p className="mt-1 text-xs leading-relaxed text-fg-subtle">
                    Pending approvals expire after this long and the action is not taken. Off = the platform default.
                  </p>
                </div>
                <Switch id="policy-ttl-custom" checked={field.value} onCheckedChange={field.onChange} disabled={readOnly} />
              </div>
            )}
          />
          {ttlCustom && (
            <Field label="Expire approvals after" error={formState.errors.approval_ttl_value?.message} description="Between 1 minute and 7 days.">
              {(ids) => (
                <div className="flex max-w-sm gap-2">
                  <Input {...ids} type="number" inputMode="decimal" min={1} step="any" disabled={readOnly} className="w-28" {...register("approval_ttl_value", { valueAsNumber: true })} />
                  <Controller
                    control={control}
                    name="approval_ttl_unit"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={(v) => field.onChange(v as TtlUnit)} disabled={readOnly}>
                        <SelectTrigger className="w-32" aria-label="Unit">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="minutes">minutes</SelectItem>
                          <SelectItem value="hours">hours</SelectItem>
                          <SelectItem value="days">days</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              )}
            </Field>
          )}
        </div>
        <div className="grid gap-3 border-t border-line pt-5">
          <Controller
            control={control}
            name="max_concurrent_custom"
            render={({ field }) => (
              <div className="flex items-start justify-between gap-4">
                <div>
                  <label htmlFor="policy-concurrency" className="text-[13px] font-medium text-fg">
                    Limit concurrent tasks per person
                  </label>
                  <p className="mt-1 text-xs leading-relaxed text-fg-subtle">
                    The effective limit is the lowest of this value, the platform limit and your plan
                    {planConcurrency ? (
                      <>
                        {" "}
                        (<span className="text-fg-muted">{planConcurrency} on the {entitlements.data?.plan.display_name} plan</span>)
                      </>
                    ) : null}
                    .
                  </p>
                </div>
                <Switch id="policy-concurrency" checked={field.value} onCheckedChange={field.onChange} disabled={readOnly} />
              </div>
            )}
          />
          {concurrencyCustom && (
            <Field label="Active tasks per person" error={formState.errors.max_concurrent_value?.message} description={`${MAX_CONCURRENT_MIN}–${MAX_CONCURRENT_MAX}`}>
              {(ids) => (
                <Input {...ids} type="number" inputMode="numeric" min={MAX_CONCURRENT_MIN} max={MAX_CONCURRENT_MAX} step={1} disabled={readOnly} className="w-28" {...register("max_concurrent_value", { valueAsNumber: true })} />
              )}
            </Field>
          )}
        </div>
      </PolicySection>

      {developerMode && (
        <section className="rounded-xl border border-dashed border-line-strong bg-surface-1 px-5 py-4">
          <h3 className="text-sm font-semibold tracking-tight text-fg">Additional settings (<span className="font-mono">extra</span>)</h3>
          <p className="mt-0.5 text-[13px] text-fg-muted">Not edited here; preserved unchanged when you save.</p>
          <JsonViewer value={data.policy.extra ?? {}} className="mt-3" />
        </section>
      )}

      {canEdit && (
        <div
          className={cn(
            "sticky bottom-3 z-10 flex flex-col gap-3 rounded-xl border px-4 py-3 shadow-float backdrop-blur transition-colors sm:flex-row sm:items-center sm:justify-between",
            dirty ? "border-accent/30 bg-surface-3/95" : "border-line bg-surface-2/90",
          )}
        >
          <p className="text-[13px] text-fg-muted" aria-live="polite">
            {dirty ? "You have unsaved policy changes." : `Up to date · version ${data.policy_version}`}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={!dirty} onClick={() => reset(policyToForm(data.policy))}>
              Discard
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={!dirty}>
              Review & save
            </Button>
          </div>
        </div>
      )}

      <Dialog open={review} onOpenChange={(o) => !save.isPending && setReview(o)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Save policy version {data.policy_version + 1}?</DialogTitle>
            <DialogDescription>New tasks in this organization use the updated policy right away. The change is recorded in the audit log.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {pending.length === 0 ? (
              <p className="text-sm text-fg-muted">Only formatting changed (entries were normalized). Saving still creates a new version.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                {pending.map((c) => (
                  <li key={c.field} className="grid gap-1 px-4 py-3 text-[13px] sm:grid-cols-[10rem_minmax(0,1fr)]">
                    <span className="font-medium text-fg">{c.label}</span>
                    <span className="min-w-0 break-words">
                      <span className="text-fg-subtle line-through decoration-fg-subtle/60">{c.before}</span>
                      <span className="mx-1.5 text-fg-subtle" aria-hidden>
                        →
                      </span>
                      <span className="sr-only"> changes to </span>
                      <span className="text-fg">{c.after}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {save.error ? <InlineError error={save.error} className="mt-3" /> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReview(false)} disabled={save.isPending}>
              Keep editing
            </Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              Save policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
