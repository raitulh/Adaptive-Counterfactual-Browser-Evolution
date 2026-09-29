"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftIcon, LockIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { EmptyState, InlineError } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { isApiError } from "@/lib/api/errors";
import { track } from "@/lib/analytics";
import { usePermissions } from "@/lib/auth/hooks";
import { useToolCatalog } from "@/components/tools/queries";
import { AgentConfigFields, ConfigSectionNav } from "./agent-config-fields";
import {
  agentCreateSchema,
  defaultCreateValues,
  formValuesToCreatePayload,
  LIMITS,
  mapBackendFieldErrors,
  type AgentConfigValues,
  type AgentCreateValues,
} from "./agent-form";
import { useCreateAgent } from "./queries";

export function CreateAgentPage() {
  const router = useRouter();
  const { can, isLoading: permsLoading } = usePermissions();
  const tools = useToolCatalog();
  const create = useCreateAgent();
  const [error, setError] = React.useState<unknown>(null);
  const form = useForm<AgentCreateValues>({ resolver: zodResolver(agentCreateSchema), defaultValues: defaultCreateValues(), mode: "onTouched" });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const agent = await create.mutateAsync(formValuesToCreatePayload(values));
      track("agent_created", { agent_id: agent.id });
      toast.success(`${agent.name} created`, { description: "Version 1 is now current." });
      router.push(`/app/agents/${agent.id}`);
    } catch (err) {
      if (isApiError(err)) {
        if (err.kind === "validation") for (const [field, message] of mapBackendFieldErrors(err.fieldErrors)) form.setError(field, { message });
        if (err.kind === "conflict") form.setError("name", { message: err.userMessage });
      }
      setError(err);
    }
  }, () => {
    // Bring the first invalid field into view.
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
  });

  const back = (
    <Link href="/app/agents" className="inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg">
      <ArrowLeftIcon className="size-3.5" aria-hidden /> Agents
    </Link>
  );

  if (!permsLoading && !can("agents:manage")) {
    return (
      <PageContainer>
        <PageHeader eyebrow={back} title="New agent" />
        <EmptyState
          icon={<LockIcon />}
          title="You can't create agents"
          description="Creating agents requires the agents:manage permission. Ask an organization owner or admin."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        eyebrow={back}
        title="New agent"
        description="An agent is a named, versioned configuration. Creating it publishes version 1; later changes create new immutable versions."
      />
      <form onSubmit={onSubmit} noValidate className="grid gap-8 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <ConfigSectionNav extra={[{ id: "identity", label: "Name & description" }]} />
        <div className="flex min-w-0 flex-col gap-5">
          <Card id="section-identity" className="scroll-mt-24">
            <div className="grid gap-5 px-5 py-5">
              <Field label="Name" required error={errors.name?.message} description="Unique in your organization. Names can't be changed later.">
                {(ids) => <Input {...ids} {...form.register("name")} autoFocus maxLength={LIMITS.name + 20} autoComplete="off" placeholder="e.g. Sales scheduler" />}
              </Field>
              <Field label="Description" error={errors.description?.message} description="What this agent is for (shown to your team).">
                {(ids) => <Textarea {...ids} {...form.register("description")} rows={2} placeholder="Books customer meetings and sends confirmations." />}
              </Field>
            </div>
          </Card>

          <AgentConfigFields
            form={form as unknown as UseFormReturn<AgentConfigValues>}
            tools={tools.data}
            toolsError={tools.isError}
          />

          <div className="sticky bottom-0 z-20 -mx-4 border-t border-line bg-bg/85 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-5">
            {error !== null && <InlineError error={error} className="mb-3" />}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-fg-subtle">Creates the agent and publishes its first immutable version (v1).</p>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => router.push("/app/agents")}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={isSubmitting}>
                  Create agent
                </Button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </PageContainer>
  );
}
