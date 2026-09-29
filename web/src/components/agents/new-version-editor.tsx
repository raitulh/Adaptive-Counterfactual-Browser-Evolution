"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { GitBranchPlusIcon, InfoIcon, RotateCcwIcon } from "lucide-react";
import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InlineError } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import type { AgentVersionOut, ToolOut } from "@/lib/api";
import { isApiError } from "@/lib/api/errors";
import { track } from "@/lib/analytics";
import { AgentConfigFields, ConfigSectionNav } from "./agent-config-fields";
import {
  agentConfigSchema,
  configToFormValues,
  formValuesToVersionPayload,
  mapBackendFieldErrors,
  type AgentConfigValues,
} from "./agent-form";
import { useCreateAgentVersion } from "./queries";
import { diffConfigs } from "./version-diff";
import { VersionDiffView } from "./version-diff-view";

/**
 * Editor for the next immutable version, prefilled from the current one. Publishing never edits
 * history: it appends vN+1 and makes it current.
 */
export function NewVersionEditor({
  agentId,
  current,
  latestNumber,
  tools,
  toolsError,
  onPublished,
}: {
  agentId: string;
  current: AgentVersionOut;
  /** Highest existing version number (the new one gets +1). */
  latestNumber: number;
  tools?: ToolOut[];
  toolsError?: boolean;
  onPublished: (version: AgentVersionOut, previous: AgentVersionOut) => void;
}) {
  const create = useCreateAgentVersion(agentId);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);
  const form = useForm<AgentConfigValues>({
    resolver: zodResolver(agentConfigSchema),
    defaultValues: configToFormValues(current),
    mode: "onTouched",
  });

  // Re-seed when the current version changes underneath (e.g. someone else published) unless the
  // user has unsaved edits.
  React.useEffect(() => {
    if (!form.formState.isDirty) form.reset(configToFormValues(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.id]);

  const values = useWatch({ control: form.control }) as AgentConfigValues;
  const parsed = agentConfigSchema.safeParse(values);
  const draft = parsed.success ? formValuesToVersionPayload(parsed.data) : null;
  const diff = draft ? diffConfigs(current, draft) : null;
  const nextNumber = latestNumber + 1;

  const review = form.handleSubmit(
    () => {
      setError(null);
      setReviewOpen(true);
    },
    () => requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid=true]")?.focus()),
  );

  const publish = async () => {
    const valid = agentConfigSchema.safeParse(form.getValues());
    if (!valid.success) return;
    setError(null);
    try {
      const version = await create.mutateAsync(formValuesToVersionPayload(valid.data));
      track("agent_version_created", { agent_id: agentId, version_number: version.version_number });
      toast.success(`v${version.version_number} published`, {
        description: "It is now the current version for new tasks.",
      });
      setReviewOpen(false);
      form.reset(configToFormValues(version));
      onPublished(version, current);
    } catch (err) {
      if (isApiError(err) && err.kind === "validation") {
        for (const [field, message] of mapBackendFieldErrors(err.fieldErrors)) {
          if (field !== "name" && field !== "description") form.setError(field, { message });
        }
      }
      setError(err);
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[11rem_minmax(0,1fr)]">
      <ConfigSectionNav />
      <form onSubmit={review} noValidate className="flex min-w-0 flex-col gap-5">
        <div
          role="note"
          className="flex gap-3 rounded-xl border border-info/25 bg-info/[0.06] px-4 py-3 text-[13px] leading-relaxed text-fg-muted"
        >
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <p>
            You are drafting <span className="font-mono font-medium text-fg">v{nextNumber}</span>, prefilled from{" "}
            <span className="font-mono text-fg">v{current.version_number}</span>. Publishing creates a new immutable
            version and makes it current for new tasks. <span className="font-mono">v{current.version_number}</span> and
            earlier versions are never modified, and tasks keep the exact version they ran with.
          </p>
        </div>

        <AgentConfigFields form={form} tools={tools} toolsError={toolsError} />

        <div className="sticky bottom-0 z-20 -mx-4 border-t border-line bg-bg/85 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-5">
          {error !== null && !reviewOpen && <InlineError error={error} className="mb-3" />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-fg-subtle" aria-live="polite">
              {!diff
                ? "Fix the highlighted fields to see the changes."
                : diff.identical
                  ? `No changes from v${current.version_number} yet.`
                  : `${diff.changeCount} ${diff.changeCount === 1 ? "change" : "changes"} from v${current.version_number}.`}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={!form.formState.isDirty}
                onClick={() => {
                  form.reset(configToFormValues(current));
                  setError(null);
                }}
              >
                <RotateCcwIcon /> Discard changes
              </Button>
              <Button type="submit" variant="primary" disabled={diff?.identical}>
                <GitBranchPlusIcon /> Review v{nextNumber}
              </Button>
            </div>
          </div>
        </div>
      </form>

      <Dialog open={reviewOpen} onOpenChange={(o) => !create.isPending && setReviewOpen(o)}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>
              Publish <span className="font-mono">v{nextNumber}</span>?
            </DialogTitle>
            <DialogDescription>
              This appends an immutable version and makes it current. History is never edited — you can compare or copy
              from any earlier version later.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {diff && (
              <VersionDiffView
                diff={diff}
                beforeLabel={`v${current.version_number}`}
                afterLabel={`v${nextNumber} (draft)`}
              />
            )}
            {error !== null && <InlineError error={error} className="mt-4" />}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReviewOpen(false)} disabled={create.isPending}>
              Keep editing
            </Button>
            <Button variant="primary" onClick={() => void publish()} loading={create.isPending}>
              Publish v{nextNumber}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
