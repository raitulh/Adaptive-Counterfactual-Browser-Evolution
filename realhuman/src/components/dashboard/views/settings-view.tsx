"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { MockNotice } from "@/components/dashboard/mock-notice";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field, Label } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton, Spinner } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/states";
import { useProjectSettings, useUpdateProjectSettings } from "@/hooks/use-dashboard-data";
import { toApiError } from "@/lib/api";
import { projectSettingsSchema, type ProjectSettingsValues } from "@/lib/schemas/forms";

export function SettingsView() {
  const settings = useProjectSettings();
  const update = useUpdateProjectSettings();
  const form = useForm<ProjectSettingsValues>({
    resolver: zodResolver(projectSettingsSchema),
    mode: "onTouched",
  });
  const { errors, isDirty, isSubmitting } = form.formState;

  useEffect(() => {
    if (settings.data) {
      const { projectName, allowThreshold, stepUpThreshold, retentionDays } = settings.data;
      form.reset({ projectName, allowThreshold, stepUpThreshold, retentionDays });
    }
  }, [settings.data, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync(values);
      toast.success("Settings saved");
    } catch (error) {
      toast.error("Couldn't save settings", { description: toApiError(error).message });
    }
  });

  return (
    <>
      <PageHeader title="Settings" description="Project configuration and verification policy." />
      <MockNotice>Changes are kept in memory for this browser session only.</MockNotice>

      {settings.isPending ? (
        <div className="flex flex-col gap-4" aria-busy>
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      ) : settings.isError ? (
        <ErrorState
          title="Couldn't load settings"
          description={toApiError(settings.error).message}
          onRetry={() => void settings.refetch()}
        />
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex max-w-3xl flex-col gap-6">
          <section
            aria-labelledby="project-title"
            className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-5 sm:p-6"
          >
            <h2 id="project-title" className="text-[15px] font-medium">
              Project
            </h2>
            <Field id="project-name" label="Project name" error={errors.projectName?.message}>
              {(control) => <Input {...control} {...form.register("projectName")} />}
            </Field>
            <div className="flex flex-col gap-2">
              <Label htmlFor="site-key">Public site key</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="site-key"
                  readOnly
                  value={settings.data.siteKey}
                  className="font-mono text-xs"
                />
                <CopyButton value={settings.data.siteKey} label="Copy site key" />
              </div>
              <p className="text-xs text-subtle">
                Safe to embed in browser code. It cannot redeem tokens.
              </p>
            </div>
          </section>

          <section
            aria-labelledby="policy-title"
            className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-5 sm:p-6"
          >
            <div className="flex flex-col gap-1">
              <h2 id="policy-title" className="text-[15px] font-medium">
                Verification policy
              </h2>
              <p className="text-sm text-muted">
                Scores between the two thresholds receive a step-up challenge.
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                id="allow-threshold"
                label="Allow at or above"
                error={errors.allowThreshold?.message}
              >
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    step="0.01"
                    min="0.5"
                    max="0.99"
                    inputMode="decimal"
                    {...form.register("allowThreshold", { valueAsNumber: true })}
                  />
                )}
              </Field>
              <Field
                id="stepup-threshold"
                label="Step-up at or above"
                error={errors.stepUpThreshold?.message}
              >
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    step="0.01"
                    min="0.1"
                    max="0.95"
                    inputMode="decimal"
                    {...form.register("stepUpThreshold", { valueAsNumber: true })}
                  />
                )}
              </Field>
            </div>
            <Field
              id="retention"
              label="Session record retention"
              error={errors.retentionDays?.message}
              hint="Choose the shortest window that supports debugging and abuse review."
            >
              {(control) => (
                <NativeSelect {...control} {...form.register("retentionDays")}>
                  <option value="1">1 day</option>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                </NativeSelect>
              )}
            </Field>
          </section>

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={!isDirty || isSubmitting}
              onClick={() => form.reset()}
            >
              Discard
            </Button>
            <Button type="submit" disabled={!isDirty || isSubmitting}>
              {isSubmitting ? <Spinner label="Saving" /> : null}
              Save changes
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
