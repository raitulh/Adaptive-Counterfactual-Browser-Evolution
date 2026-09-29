"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlagIcon, PencilIcon, PlusIcon } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
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
import { EmptyState, ErrorState, InlineError } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/controls";
import { toast } from "@/components/ui/toaster";
import { adminApi, type FlagIn } from "@/lib/api";
import { humanize } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { cn } from "@/lib/utils";
import { useAdminOrganizations } from "./admin-organizations";
import { AdminSection } from "./admin-shell";

interface Override {
  key: string;
  tenant_id: string | null;
  enabled: boolean;
  rollout_percentage: number;
}

const FLAG_LABEL: Record<string, string> = {
  browser_agent_enabled: "Browser agent",
  mcp_enabled: "MCP servers",
  acbe_enabled: "ACBE self-improvement",
  multi_agent_enabled: "Multi-agent orchestration",
  experimental_memory_enabled: "Experimental memory",
  web_search_enabled: "Web search",
  memory_extraction_enabled: "Automatic memory extraction",
};

export function flagLabel(key: string): string {
  return FLAG_LABEL[key] ?? humanize(key.replace(/_enabled$/, ""));
}

function parseFlags(raw: Record<string, unknown> | undefined): {
  defaults: Record<string, boolean>;
  overrides: Override[];
} {
  const defaults = raw?.defaults && typeof raw.defaults === "object" ? (raw.defaults as Record<string, boolean>) : {};
  const overrides = Array.isArray(raw?.overrides)
    ? (raw.overrides as Array<Record<string, unknown>>).map((o) => ({
        key: String(o.key ?? ""),
        tenant_id: typeof o.tenant_id === "string" ? o.tenant_id : null,
        enabled: Boolean(o.enabled),
        rollout_percentage: typeof o.rollout_percentage === "number" ? o.rollout_percentage : 100,
      }))
    : [];
  return { defaults, overrides };
}

type Draft = {
  key: string;
  tenant_id: string | null;
  enabled: boolean;
  rollout_percentage: number;
  description: string;
};
const GLOBAL = "__global";

export function AdminFeatureFlags() {
  const flags = useQuery({
    queryKey: qk.admin.featureFlags,
    queryFn: ({ signal }) => adminApi.featureFlags({ signal }),
  });
  const orgs = useAdminOrganizations();
  const orgName = React.useMemo(() => new Map((orgs.data ?? []).map((o) => [o.id, o.name])), [orgs.data]);
  const [draft, setDraft] = React.useState<Draft | null>(null);

  if (flags.error) return <ErrorState error={flags.error} onRetry={() => void flags.refetch()} />;
  if (!flags.data) return <Skeleton className="h-72 rounded-xl" />;
  const { defaults, overrides } = parseFlags(flags.data);
  const keys = [...new Set([...Object.keys(defaults), ...overrides.map((o) => o.key)])].sort();
  const scopeName = (t: string | null) => (t ? (orgName.get(t) ?? `${t.slice(0, 8)}…`) : "All organizations");

  return (
    <div className="flex flex-col gap-8">
      <AdminSection
        title="Feature flags"
        description="Defaults live in code. An override applies globally or to one organization, optionally to a deterministic percentage of organizations. Flags gate features — never authorization."
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              setDraft({ key: keys[0] ?? "", tenant_id: null, enabled: true, rollout_percentage: 100, description: "" })
            }
          >
            <PlusIcon /> New override
          </Button>
        }
      >
        <div className="relative overflow-x-auto rounded-xl border border-line bg-surface-1">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <caption className="sr-only">Feature flags</caption>
            <thead>
              <tr className="border-b border-line text-2xs tracking-wider text-fg-subtle uppercase">
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Flag
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Default
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Overrides
                </th>
                <th scope="col" className="px-4 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const own = overrides.filter((o) => o.key === key);
                const def = defaults[key];
                return (
                  <tr key={key} className="border-b border-line align-top last:border-0">
                    <td className="px-4 py-3">
                      <div className="text-fg">{flagLabel(key)}</div>
                      <div className="font-mono text-2xs text-fg-subtle">{key}</div>
                    </td>
                    <td className="px-4 py-3">
                      {def === undefined ? (
                        <span className="text-xs text-fg-subtle">no default</span>
                      ) : (
                        <Badge tone={def ? "success" : "neutral"}>{def ? "On" : "Off"}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {own.length === 0 ? (
                        <span className="text-xs text-fg-subtle">None</span>
                      ) : (
                        <ul className="flex flex-col gap-1.5">
                          {own.map((o) => (
                            <li key={`${o.key}:${o.tenant_id}`} className="flex flex-wrap items-center gap-2">
                              <Badge tone={o.enabled ? "success" : "danger"} variant="outline">
                                {o.enabled ? "On" : "Off"}
                                {o.rollout_percentage < 100 ? ` · ${o.rollout_percentage}%` : ""}
                              </Badge>
                              <span className="text-xs text-fg-muted">{scopeName(o.tenant_id)}</span>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`Edit ${key} override for ${scopeName(o.tenant_id)}`}
                                onClick={() =>
                                  setDraft({
                                    key: o.key,
                                    tenant_id: o.tenant_id,
                                    enabled: o.enabled,
                                    rollout_percentage: o.rollout_percentage,
                                    description: "",
                                  })
                                }
                              >
                                <PencilIcon />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() =>
                          setDraft({
                            key,
                            tenant_id: null,
                            enabled: !(def ?? false),
                            rollout_percentage: 100,
                            description: "",
                          })
                        }
                      >
                        Override
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {keys.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <EmptyState size="sm" icon={<FlagIcon />} title="No flags defined" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-fg-subtle">
          Overrides can&apos;t be deleted; to restore the default behaviour, set the override to the default value.
          Changes apply within about 30 seconds.
        </p>
      </AdminSection>
      <FlagDialog
        draft={draft}
        keys={Object.keys(defaults)}
        defaults={defaults}
        orgs={(orgs.data ?? []).map((o) => ({ id: o.id, name: o.name }))}
        onClose={() => setDraft(null)}
      />
    </div>
  );
}

function FlagDialog({
  draft,
  keys,
  defaults,
  orgs,
  onClose,
}: {
  draft: Draft | null;
  keys: string[];
  defaults: Record<string, boolean>;
  orgs: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = React.useState<Draft | null>(draft);
  const [source, setSource] = React.useState<Draft | null>(draft);
  if (draft !== source) {
    setSource(draft);
    setValue(draft);
  }
  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body: FlagIn = {
        key: d.key.trim(),
        tenant_id: d.tenant_id,
        enabled: d.enabled,
        rollout_percentage: d.rollout_percentage,
        description: d.description.trim() || null,
      };
      return adminApi.setFeatureFlag(body);
    },
    onSuccess: (_r, d) => {
      toast.success(`${flagLabel(d.key)} ${d.enabled ? "enabled" : "disabled"}`, {
        description: d.tenant_id ? "For one organization." : "For all organizations.",
      });
      void queryClient.invalidateQueries({ queryKey: qk.admin.featureFlags });
      onClose();
    },
  });
  const valid =
    value !== null &&
    value.key.trim().length > 0 &&
    value.key.length <= 100 &&
    Number.isInteger(value.rollout_percentage) &&
    value.rollout_percentage >= 0 &&
    value.rollout_percentage <= 100;
  const custom = value !== null && !keys.includes(value.key);

  return (
    <Dialog
      open={draft !== null}
      onOpenChange={(o) => {
        if (!o && !save.isPending) {
          save.reset();
          onClose();
        }
      }}
    >
      <DialogContent size="md">
        {value && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) save.mutate(value);
            }}
          >
            <DialogHeader>
              <DialogTitle>Set feature flag override</DialogTitle>
              <DialogDescription>
                Creates the override, or updates the existing one for the same flag and scope.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-4">
              <Field
                label="Flag"
                description={
                  custom
                    ? "Custom key — only meaningful if the platform checks it."
                    : defaults[value.key] !== undefined
                      ? `Default: ${defaults[value.key] ? "on" : "off"}`
                      : undefined
                }
              >
                {(ids) => (
                  <Select
                    value={custom ? "__custom" : value.key}
                    onValueChange={(k) => setValue({ ...value, key: k === "__custom" ? "" : k })}
                  >
                    <SelectTrigger {...ids}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {keys.map((k) => (
                        <SelectItem key={k} value={k}>
                          {flagLabel(k)} <span className="font-mono text-2xs text-fg-subtle">{k}</span>
                        </SelectItem>
                      ))}
                      <SelectItem value="__custom">Other key…</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>
              {custom && (
                <Field label="Flag key">
                  {(ids) => (
                    <Input
                      {...ids}
                      value={value.key}
                      onChange={(e) => setValue({ ...value, key: e.target.value })}
                      maxLength={100}
                      className="font-mono"
                      placeholder="my_feature_enabled"
                    />
                  )}
                </Field>
              )}
              <Field label="Scope">
                {(ids) => (
                  <Select
                    value={value.tenant_id ?? GLOBAL}
                    onValueChange={(t) => setValue({ ...value, tenant_id: t === GLOBAL ? null : t })}
                  >
                    <SelectTrigger {...ids}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={GLOBAL}>All organizations (global)</SelectItem>
                      {orgs.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <div className="flex items-center justify-between rounded-lg border border-line p-3">
                <label htmlFor="flag-enabled" className="text-[13px] font-medium text-fg">
                  Enabled
                  <span className="block text-xs font-normal text-fg-subtle">
                    {value.enabled
                      ? "The feature is available where this override applies."
                      : "The feature is turned off where this override applies."}
                  </span>
                </label>
                <Switch
                  id="flag-enabled"
                  checked={value.enabled}
                  onCheckedChange={(c) => setValue({ ...value, enabled: c })}
                />
              </div>
              <Field
                label="Rollout percentage"
                description="0–100. Organizations are bucketed deterministically by flag and organization id."
              >
                {(ids) => (
                  <Input
                    {...ids}
                    type="number"
                    min={0}
                    max={100}
                    value={Number.isFinite(value.rollout_percentage) ? value.rollout_percentage : ""}
                    onChange={(e) => setValue({ ...value, rollout_percentage: e.target.valueAsNumber })}
                    className={cn("w-28 font-mono")}
                  />
                )}
              </Field>
              <Field label="Note" description="Optional, max 500 characters.">
                {(ids) => (
                  <Input
                    {...ids}
                    value={value.description}
                    maxLength={500}
                    onChange={(e) => setValue({ ...value, description: e.target.value })}
                    placeholder="Why this override exists"
                  />
                )}
              </Field>
              {save.error ? <InlineError error={save.error} /> : null}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={save.isPending} disabled={!valid}>
                Save override
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
