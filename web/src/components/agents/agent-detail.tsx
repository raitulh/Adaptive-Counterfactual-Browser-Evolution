"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeftIcon,
  BotIcon,
  GitBranchPlusIcon,
  HistoryIcon,
  LayoutListIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PowerOffIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RadioGroup, RadioGroupItem, Skeleton } from "@/components/ui/controls";
import { IdChip, RelativeTime } from "@/components/ui/data-display";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, Label } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { PageContainer } from "@/components/ui/page";
import { EmptyState, ErrorState, InlineError } from "@/components/ui/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast, toastError } from "@/components/ui/toaster";
import type { AgentOut } from "@/lib/api";
import { isApiError } from "@/lib/api/errors";
import { usePermissions } from "@/lib/auth/hooks";
import { dateTime } from "@/lib/format";
import { useUiStore } from "@/stores/ui";
import { useToolCatalog } from "@/components/tools/queries";
import { agentMetadataSchema, type AgentMetadataValues } from "./agent-form";
import { AgentOverview } from "./agent-overview";
import { AGENT_STATUSES, AgentStatusBadge, agentStatusMeta, VersionBadge } from "./agent-status";
import { AgentVersions, Checksum, type ComparePair } from "./agent-versions";
import { NewVersionEditor } from "./new-version-editor";
import { useAgent, useAgentVersions, useDeleteAgent, useUpdateAgent } from "./queries";

type TabValue = "overview" | "versions" | "new-version";
const TABS: TabValue[] = ["overview", "versions", "new-version"];

function EditDetailsDialog({
  agent,
  open,
  onOpenChange,
}: {
  agent: AgentOut;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const update = useUpdateAgent(agent.id);
  const [error, setError] = React.useState<unknown>(null);
  const form = useForm<AgentMetadataValues>({
    resolver: zodResolver(agentMetadataSchema),
    values: { description: agent.description ?? "", status: agent.status === "disabled" ? "disabled" : "active" },
  });
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await update.mutateAsync({
        description: v.description.trim() === "" ? null : v.description.trim(),
        status: v.status,
      });
      toast.success("Agent details saved");
      onOpenChange(false);
    } catch (err) {
      if (isApiError(err) && err.kind === "validation") {
        const fe = err.fieldErrors;
        if (fe.description) form.setError("description", { message: fe.description });
        if (fe.status) form.setError("status", { message: fe.status });
      }
      setError(err);
    }
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !update.isPending && onOpenChange(o)}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Edit details</DialogTitle>
            <DialogDescription>
              Metadata changes apply immediately and do not create a version. Configuration changes go through “New
              version”.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            <Field label="Name" description="Agent names are permanent.">
              {(ids) => <Input {...ids} value={agent.name} readOnly disabled />}
            </Field>
            <Field label="Description" error={form.formState.errors.description?.message}>
              {(ids) => <Textarea {...ids} {...form.register("description")} rows={3} />}
            </Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[13px] font-medium text-fg">Status</legend>
              <Controller
                control={form.control}
                name="status"
                render={({ field }) => (
                  <RadioGroup value={field.value} onValueChange={field.onChange} className="gap-2">
                    {AGENT_STATUSES.map((s) => (
                      <div key={s} className="flex items-start gap-2.5 rounded-lg border border-line px-3 py-2.5">
                        <RadioGroupItem value={s} id={`agent-status-${s}`} className="mt-0.5" />
                        <Label htmlFor={`agent-status-${s}`} className="flex flex-col gap-0.5 font-normal">
                          <span className="font-medium">{agentStatusMeta[s].label}</span>
                          <span className="text-xs text-fg-muted">{agentStatusMeta[s].description}</span>
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                )}
              />
            </fieldset>
            {error !== null && <InlineError error={error} />}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={update.isPending} disabled={!form.formState.isDirty}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HeaderSkeleton() {
  return (
    <div className="flex flex-col gap-3 pb-6">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="flex gap-2">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-24" />
      </div>
    </div>
  );
}

export function AgentDetail({ agentId }: { agentId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const developerMode = useUiStore((s) => s.developerMode);
  const { can } = usePermissions();
  const canManage = can("agents:manage");

  // Stops detail refetches (404s) while a delete is in flight and the page navigates away.
  const [removing, setRemoving] = React.useState(false);
  const agentQ = useAgent(agentId, !removing);
  const versionsQ = useAgentVersions(agentId, !removing);
  const tools = useToolCatalog();
  const remove = useDeleteAgent();

  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [pair, setPair] = React.useState<ComparePair | null>(null);

  const requested = searchParams.get("tab") as TabValue | null;
  const tab: TabValue =
    requested && TABS.includes(requested) && (requested !== "new-version" || canManage) ? requested : "overview";
  const setTab = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "overview") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const back = (
    <Link href="/app/agents" className="inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg">
      <ArrowLeftIcon className="size-3.5" aria-hidden /> Agents
    </Link>
  );

  if (agentQ.isError) {
    return (
      <PageContainer>
        <div className="pb-4">{back}</div>
        <ErrorState error={agentQ.error} onRetry={() => void agentQ.refetch()} />
      </PageContainer>
    );
  }

  const agent = agentQ.data;
  const current = agent?.current_version ?? null;
  const latestNumber = Math.max(current?.version_number ?? 0, ...(versionsQ.data ?? []).map((v) => v.version_number));

  const onDelete = async () => {
    if (!agent) return;
    setRemoving(true);
    try {
      await remove.mutateAsync(agent.id);
      toast.success(`${agent.name} deleted`);
      setDeleteOpen(false);
      router.push("/app/agents");
    } catch (err) {
      setRemoving(false);
      toastError(err, "Couldn't delete the agent");
    }
  };

  return (
    <PageContainer width="wide">
      {!agent ? (
        <HeaderSkeleton />
      ) : (
        <header className="flex flex-col gap-4 pb-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            {back}
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface-2 text-fg-muted">
                <BotIcon className="size-4.5" aria-hidden />
              </div>
              <h1 className="min-w-0 text-2xl font-semibold tracking-tight break-words text-fg sm:text-[28px]">
                {agent.name}
              </h1>
              <AgentStatusBadge status={agent.status} />
              <VersionBadge number={current?.version_number} current />
            </div>
            {agent.description && (
              <p className="max-w-2xl text-sm leading-relaxed text-fg-muted">{agent.description}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-subtle">
              {current && <Checksum value={current.checksum} />}
              <span title={dateTime(agent.created_at)}>
                Created <RelativeTime value={agent.created_at} />
              </span>
              <span>
                Updated <RelativeTime value={agent.updated_at} />
              </span>
              {developerMode && <IdChip id={agent.id} label="agent" />}
            </div>
          </div>
          {canManage && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
                <PencilIcon /> Edit details
              </Button>
              <Button variant="primary" size="sm" onClick={() => setTab("new-version")} disabled={!current}>
                <GitBranchPlusIcon /> New version
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="More actions">
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem tone="danger" onSelect={() => setDeleteOpen(true)}>
                    <Trash2Icon /> Delete agent
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </header>
      )}

      {agent?.status === "disabled" && (
        <div
          role="status"
          className="mb-5 flex items-start gap-2.5 rounded-xl border border-line-strong bg-surface-2 px-4 py-3 text-[13px] text-fg-muted"
        >
          <PowerOffIcon className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
          <p>
            <span className="font-medium text-fg">This agent is disabled.</span> New tasks can&apos;t use it until it is
            re-enabled; its versions are kept.
            {canManage && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  Change status
                </button>
              </>
            )}
          </p>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Agent sections" className="max-w-full overflow-x-auto">
          <TabsTrigger value="overview">
            <LayoutListIcon /> Overview
          </TabsTrigger>
          <TabsTrigger value="versions">
            <HistoryIcon /> Versions
            {versionsQ.data && <span className="font-mono text-2xs text-fg-subtle">{versionsQ.data.length}</span>}
          </TabsTrigger>
          {canManage && (
            <TabsTrigger value="new-version">
              <GitBranchPlusIcon /> New version
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="overview" className="mt-5">
          {!agent ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Skeleton className="h-48 rounded-xl lg:col-span-2" />
              <Skeleton className="h-40 rounded-xl" />
              <Skeleton className="h-40 rounded-xl" />
            </div>
          ) : current ? (
            <AgentOverview agent={agent} version={current} tools={tools.data} />
          ) : (
            <Card>
              <EmptyState
                title="No current version"
                description="This agent has no published configuration. Publish a version to use it."
              />
            </Card>
          )}
        </TabsContent>

        <TabsContent value="versions" className="mt-5">
          <AgentVersions
            agentId={agentId}
            enabled={!removing}
            currentVersionId={agent?.current_version_id ?? null}
            pair={pair}
            onPairChange={setPair}
          />
        </TabsContent>

        {canManage && (
          <TabsContent value="new-version" className="mt-5">
            {current ? (
              <NewVersionEditor
                agentId={agentId}
                current={current}
                latestNumber={latestNumber}
                tools={tools.data}
                toolsError={tools.isError}
                onPublished={(version, previous) => {
                  setPair({ base: previous.version_number, target: version.version_number });
                  setTab("versions");
                  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                  window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
                }}
              />
            ) : (
              <Skeleton className="h-96 rounded-xl" />
            )}
          </TabsContent>
        )}
      </Tabs>

      {agent && canManage && <EditDetailsDialog agent={agent} open={editOpen} onOpenChange={setEditOpen} />}
      {agent && (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          tone="danger"
          title={`Delete ${agent.name}?`}
          description="The agent is removed and can no longer be selected for new tasks. Past tasks keep a record of the exact version they ran with."
          confirmText={agent.name}
          confirmLabel="Delete agent"
          loading={remove.isPending}
          onConfirm={onDelete}
        />
      )}
    </PageContainer>
  );
}
