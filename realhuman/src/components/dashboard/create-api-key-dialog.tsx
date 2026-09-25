"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, Label } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/primitives";
import { useCreateApiKey } from "@/hooks/use-dashboard-data";
import { apiMode, toApiError } from "@/lib/api";
import { createApiKeySchema, type CreateApiKeyValues } from "@/lib/schemas/forms";
import { cn } from "@/lib/utils/cn";

/**
 * Creates a key and reveals the secret exactly once. The secret lives only in
 * this component's state and is discarded when the dialog closes.
 */
export function CreateApiKeyDialog() {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const createKey = useCreateApiKey();
  const form = useForm<CreateApiKeyValues>({
    resolver: zodResolver(createApiKeySchema),
    defaultValues: { name: "", environment: "test" },
  });
  const environment = useWatch({ control: form.control, name: "environment" });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const created = await createKey.mutateAsync(values);
      setSecret(created.secret);
    } catch (error) {
      form.setError("root", { message: toApiError(error).message });
    }
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      if (secret)
        toast.success("API key created", { description: "The secret is no longer displayed." });
      setSecret(null);
      form.reset();
      createKey.reset();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden />
          Create key
        </Button>
      </DialogTrigger>
      <DialogContent
        onInteractOutside={(event) => {
          // Don't lose an unsaved secret to a stray click.
          if (secret) event.preventDefault();
        }}
      >
        {secret ? (
          <div className="flex flex-col gap-5">
            <DialogHeader>
              <DialogTitle>Save your secret key</DialogTitle>
              <DialogDescription>
                This is the only time the full key is shown. Store it in your server&apos;s secret
                manager.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-lg border border-border-strong bg-background p-2 pl-3">
              <code
                className="min-w-0 flex-1 truncate font-mono text-xs"
                data-testid="api-key-secret"
              >
                {secret}
              </code>
              <CopyButton value={secret} label="Copy secret key" />
            </div>
            <p className="flex items-start gap-2 text-xs text-warning">
              <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
              Never expose secret keys in browser code or commit them to a repository.
              {apiMode === "mock" ? " This mock key is not valid against any API." : ""}
            </p>
            <DialogFooter className="mt-0">
              <Button onClick={() => handleOpenChange(false)}>I&apos;ve stored it</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <DialogHeader>
              <DialogTitle>Create an API key</DialogTitle>
              <DialogDescription>
                Secret keys authenticate server-to-server calls.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-5">
              <Field
                id="key-name"
                label="Name"
                error={form.formState.errors.name?.message}
                hint="For example: Production backend"
              >
                {(control) => <Input {...control} autoComplete="off" {...form.register("name")} />}
              </Field>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-[13px] font-medium">Environment</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(["test", "live"] as const).map((value) => (
                    <label
                      key={value}
                      className={cn(
                        "flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-focus",
                        environment === value
                          ? "border-border-bright bg-surface-overlay"
                          : "border-border hover:border-border-strong",
                      )}
                    >
                      <input
                        type="radio"
                        value={value}
                        className="sr-only"
                        {...form.register("environment")}
                      />
                      <Label className="cursor-pointer capitalize" asChild>
                        <span>{value}</span>
                      </Label>
                      <span className="text-xs text-subtle">
                        {value === "test" ? "Mock and sandbox traffic" : "Production traffic"}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {form.formState.errors.root ? (
                <p role="alert" className="text-sm text-warning">
                  {form.formState.errors.root.message}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Spinner label="Creating key" /> : null}
                Create key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
