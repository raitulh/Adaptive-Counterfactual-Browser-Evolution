"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ListOrderedIcon, PlusIcon, ScaleIcon, Trash2Icon } from "lucide-react";
import * as React from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/controls";
import { IdChip } from "@/components/ui/data-display";
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
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, ErrorState, InlineError } from "@/components/ui/states";
import { toast, toastError } from "@/components/ui/toaster";
import { Tooltip } from "@/components/ui/tooltip";
import type { ToolOut, ToolRuleOut } from "@/lib/api";
import { isApiError } from "@/lib/api/errors";
import { usePermissions } from "@/lib/auth/hooks";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { matchingNames, patternSuggestions } from "./glob";
import {
  allowRuleCanWaive,
  ROLE_OPTIONS,
  RULE_EFFECTS,
  ruleEffectMeta,
  toolRuleDefaults,
  toolRuleSchema,
  toToolRulePayload,
  type ToolRuleValues,
} from "./policy-schema";
import { useCreateToolRule, useDeleteToolRule } from "./queries";

/** Plain-language description of the permission engine's order (app/permissions/service.py). */
export function PrecedenceExplainer() {
  const steps: Array<{ title: string; body: React.ReactNode }> = [
    {
      title: "Built-in guards come first",
      body: "The member's role must be allowed to run agent actions, admin-level tools are never available to agents, disabled features and the organization blocklist deny, and the agent's own tool policy must permit the tool.",
    },
    {
      title: "Deny always wins",
      body: "If any matching deny rule applies — for everyone or for the member's role — the tool is denied. No allow or approval rule can override it.",
    },
    {
      title: "Then approval rules",
      body: "If any matching rule requires approval (or the organization policy lists the tool as always requiring approval), every call waits for a person.",
    },
    {
      title: "Allow only waives default approvals",
      body: "Without a deny or approval rule, a matching allow rule removes the default approval for bounded writes: write or high-risk-write tools at low or medium risk. It never unblocks a denied tool and never waives approval for destructive, financial or high-risk actions, arguments derived from untrusted content, or when the model asks for approval.",
    },
  ];
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <ListOrderedIcon className="size-4 text-fg-subtle" aria-hidden />
        <h2 className="text-sm font-semibold tracking-tight text-fg">How rules are evaluated</h2>
      </div>
      <p className="mt-1 text-[13px] text-fg-muted">
        Patterns match tool names exactly or with <code className="font-mono text-fg">*</code> wildcards. Rules scoped
        to a role apply only to members with that role; rules without a role apply to everyone.
      </p>
      <ol className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-lg border border-line bg-surface-2/50 p-3">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-line-strong font-mono text-2xs text-fg-muted">
              {i + 1}
            </span>
            <div>
              <p className="text-[13px] font-medium text-fg">{s.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function RuleImpact({ values, tools }: { values: ToolRuleValues; tools: ToolOut[] }) {
  const pattern = values.toolPattern.trim();
  if (!pattern) return null;
  const names = tools.map((t) => t.name);
  const matched = matchingNames(pattern, names);
  const byName = new Map(tools.map((t) => [t.name, t]));
  if (matched.length === 0) {
    return (
      <p className="rounded-lg border border-warning/25 bg-warning/[0.06] px-3 py-2 text-xs text-warning">
        No tool in the current catalogue matches <code className="font-mono">{pattern}</code>. The rule will still apply
        to matching tools added later (e.g. MCP tools).
      </p>
    );
  }
  // Bounded writes that currently need approval are the only tools an allow rule can change.
  const waivable =
    values.effect === "allow"
      ? matched.filter((n) => byName.get(n)!.requires_approval && allowRuleCanWaive(byName.get(n)!))
      : [];
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-1 p-3">
      <p className="text-xs text-fg-muted">
        Matches <span className="font-medium text-fg">{matched.length}</span> {matched.length === 1 ? "tool" : "tools"}
        {values.effect === "allow" && (
          <>
            {" "}
            · removes the approval step from <span className="font-medium text-fg">{waivable.length}</span> (bounded
            writes that need approval today)
          </>
        )}
      </p>
      <ul className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
        {matched.map((n) => (
          <li
            key={n}
            className={cn(
              "rounded border px-1.5 font-mono text-2xs",
              values.effect === "allow" && !waivable.includes(n)
                ? "border-line text-fg-subtle"
                : "border-line-strong bg-surface-2 text-fg",
            )}
            title={
              values.effect === "allow" && !waivable.includes(n)
                ? "No effect: this tool runs without approval already, or its approval cannot be waived"
                : undefined
            }
          >
            {n}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddRuleDialog({
  open,
  onOpenChange,
  tools,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tools: ToolOut[];
}) {
  const create = useCreateToolRule();
  const [error, setError] = React.useState<unknown>(null);
  const form = useForm<ToolRuleValues>({ resolver: zodResolver(toolRuleSchema), defaultValues: toolRuleDefaults });
  const values = useWatch({ control: form.control }) as ToolRuleValues;
  const listId = React.useId();
  const suggestions = React.useMemo(() => patternSuggestions(tools.map((t) => t.name)), [tools]);

  const close = (o: boolean) => {
    if (create.isPending) return;
    onOpenChange(o);
    if (!o) {
      form.reset(toolRuleDefaults);
      setError(null);
    }
  };

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await create.mutateAsync(toToolRulePayload(v));
      toast.success("Rule added", { description: `${ruleEffectMeta[v.effect].label}: ${v.toolPattern}` });
      close(false);
    } catch (err) {
      if (isApiError(err) && err.kind === "validation") {
        const fe = err.fieldErrors;
        if (fe.tool_pattern) form.setError("toolPattern", { message: fe.tool_pattern });
        if (fe.reason) form.setError("reason", { message: fe.reason });
        if (fe.role) form.setError("role", { message: fe.role });
      }
      setError(err);
    }
  });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="lg">
        <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Add tool rule</DialogTitle>
            <DialogDescription>
              Rules apply to every agent in this organization and take effect for the next action that is evaluated.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            <Field
              label="Tool pattern"
              required
              error={form.formState.errors.toolPattern?.message}
              description={
                <>
                  A tool name like <code className="font-mono">gmail.send</code> or a pattern like{" "}
                  <code className="font-mono">calendar.*</code>.
                </>
              }
            >
              {(ids) => (
                <>
                  <Input
                    {...ids}
                    {...form.register("toolPattern")}
                    list={listId}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="gmail.send"
                    className="font-mono"
                    autoFocus
                  />
                  <datalist id={listId}>
                    {suggestions.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-[13px] font-medium text-fg">Effect</legend>
              <Controller
                control={form.control}
                name="effect"
                render={({ field }) => (
                  <div className="grid gap-2 sm:grid-cols-3">
                    {RULE_EFFECTS.map((e) => {
                      const meta = ruleEffectMeta[e];
                      const checked = field.value === e;
                      return (
                        <label
                          key={e}
                          className={cn(
                            "flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-accent/40",
                            checked
                              ? "border-accent/50 bg-accent/8"
                              : "border-line-strong bg-surface-1 hover:bg-surface-2",
                          )}
                        >
                          <span className="flex items-center gap-2 text-[13px] font-medium text-fg">
                            <input
                              type="radio"
                              name={field.name}
                              value={e}
                              checked={checked}
                              onChange={() => field.onChange(e)}
                              className="size-3.5 accent-[var(--color-accent)]"
                            />
                            {meta.label}
                          </span>
                          <span className="text-xs leading-relaxed text-fg-muted">{meta.description}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              />
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Applies to"
                error={form.formState.errors.role?.message}
                description="Scope the rule to one role, or everyone."
              >
                {(ids) => (
                  <Controller
                    control={form.control}
                    name="role"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger {...ids}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">Everyone</SelectItem>
                          {ROLE_OPTIONS.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.label} only
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                )}
              </Field>
              <Field
                label="Reason"
                error={form.formState.errors.reason?.message}
                description="Shown in decisions and the audit log."
              >
                {(ids) => (
                  <Textarea {...ids} {...form.register("reason")} rows={1} className="min-h-9" placeholder="Optional" />
                )}
              </Field>
            </div>

            <RuleImpact values={values} tools={tools} />
            {error !== null && <InlineError error={error} />}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={create.isPending}>
              Add rule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ToolPolicies({
  rules,
  isLoading,
  error,
  onRetry,
  tools,
}: {
  rules?: ToolRuleOut[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  tools: ToolOut[];
}) {
  const { can } = usePermissions();
  const canManage = can("tools:manage");
  const developerMode = useUiStore((s) => s.developerMode);
  const remove = useDeleteToolRule();
  const [adding, setAdding] = React.useState(false);
  const [deleting, setDeleting] = React.useState<ToolRuleOut | null>(null);
  const names = React.useMemo(() => tools.map((t) => t.name), [tools]);

  const addButton = canManage ? (
    <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
      <PlusIcon /> Add rule
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-5">
      <PrecedenceExplainer />

      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-fg">Organization rules</h2>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            {canManage
              ? "Deny, require approval for, or allow tools across all agents."
              : "Managed by members with the tools:manage permission."}
          </p>
        </div>
        {addButton}
      </div>

      {error && !rules ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : isLoading ? (
        <Card className="divide-y divide-line">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ml-auto h-4 w-24" />
            </div>
          ))}
        </Card>
      ) : !rules || rules.length === 0 ? (
        <Card>
          <EmptyState
            size="sm"
            icon={<ScaleIcon />}
            title="No organization rules"
            description="Every tool follows its built-in defaults: reads run freely, sends and other high-risk writes wait for approval, destructive and financial actions stay off unless your organization policy enables them."
            action={addButton}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {rules.map((r) => {
              const matched = matchingNames(r.tool_pattern, names);
              const meta = ruleEffectMeta[r.effect];
              return (
                <li key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className="w-40 shrink-0">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="font-mono text-[13px] text-fg">{r.tool_pattern}</code>
                      <Tooltip
                        content={
                          matched.length ? (
                            <span className="font-mono text-2xs">
                              {matched.slice(0, 12).join(", ")}
                              {matched.length > 12 ? ` +${matched.length - 12}` : ""}
                            </span>
                          ) : (
                            "No current catalogue tool matches"
                          )
                        }
                      >
                        <span
                          tabIndex={0}
                          className={cn("text-xs outline-none", matched.length ? "text-fg-subtle" : "text-warning")}
                        >
                          {matched.length} {matched.length === 1 ? "tool" : "tools"}
                        </span>
                      </Tooltip>
                      {developerMode && <IdChip id={r.id} label="rule" />}
                    </div>
                    {r.reason && <p className="mt-0.5 text-xs text-fg-muted">{r.reason}</p>}
                  </div>
                  <span className="shrink-0 text-xs text-fg-muted">
                    {r.role ? `${ROLE_OPTIONS.find((o) => o.value === r.role)?.label ?? r.role} only` : "Everyone"}
                  </span>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete rule ${r.tool_pattern}`}
                      onClick={() => setDeleting(r)}
                      className="self-end sm:self-auto"
                    >
                      <Trash2Icon />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {canManage && <AddRuleDialog open={adding} onOpenChange={setAdding} tools={tools} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        tone="danger"
        title="Delete this rule?"
        description={
          deleting && (
            <>
              <span className="font-medium text-fg">{ruleEffectMeta[deleting.effect].label}</span> for{" "}
              <code className="font-mono text-fg">{deleting.tool_pattern}</code> stops applying immediately.{" "}
              {deleting.effect === "deny"
                ? "Matching tools become available to agents again (subject to other rules and defaults)."
                : deleting.effect === "require_approval"
                  ? "Matching tools fall back to their default approval requirement."
                  : "Bounded writes it covered need approval again by default."}
            </>
          )
        }
        confirmLabel="Delete rule"
        loading={remove.isPending}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            toast.success("Rule deleted");
            setDeleting(null);
          } catch (err) {
            toastError(err, "Couldn't delete the rule");
          }
        }}
      />
    </div>
  );
}
