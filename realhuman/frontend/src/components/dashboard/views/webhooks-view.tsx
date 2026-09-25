"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2, TriangleAlert, Webhook } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { MockNotice } from "@/components/dashboard/mock-notice";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/primitives";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useCreateWebhook, useRemoveWebhook, useWebhooks } from "@/hooks/use-dashboard-data";
import { toApiError } from "@/lib/api";
import { webhookEventTypeSchema } from "@/lib/schemas/dashboard";
import { createWebhookSchema, type CreateWebhookValues } from "@/lib/schemas/forms";
import { formatUtcDateTime } from "@/lib/utils/format";

function AddEndpointDialog({ onSigningSecret }: { onSigningSecret: (secret: string) => void }) {
  const [open, setOpen] = useState(false);
  const create = useCreateWebhook();
  const form = useForm<CreateWebhookValues>({
    resolver: zodResolver(createWebhookSchema),
    defaultValues: { url: "", events: ["verification.completed"] },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const created = await create.mutateAsync(values);
      toast.success("Endpoint added");
      setOpen(false);
      form.reset();
      if (created.signingSecret) onSigningSecret(created.signingSecret);
    } catch (error) {
      form.setError("root", { message: toApiError(error).message });
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden />
          Add endpoint
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>Add a webhook endpoint</DialogTitle>
            <DialogDescription>
              We&apos;ll send a POST request for each selected event.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-5">
            <Field id="webhook-url" label="Endpoint URL" error={form.formState.errors.url?.message}>
              {(control) => (
                <Input
                  {...control}
                  type="url"
                  inputMode="url"
                  placeholder="https://api.example.com/webhooks/realhuman"
                  {...form.register("url")}
                />
              )}
            </Field>
            <fieldset
              className="flex flex-col gap-2.5"
              aria-describedby={form.formState.errors.events ? "events-error" : undefined}
            >
              <legend className="mb-1 text-[13px] font-medium">Events</legend>
              <Controller
                control={form.control}
                name="events"
                render={({ field }) => (
                  <>
                    {webhookEventTypeSchema.options.map((type) => {
                      const checked = field.value.includes(type);
                      return (
                        <label
                          key={type}
                          className="flex cursor-pointer items-center gap-3 text-sm"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) =>
                              field.onChange(
                                value
                                  ? [...field.value, type]
                                  : field.value.filter((item) => item !== type),
                              )
                            }
                          />
                          <code className="font-mono text-xs">{type}</code>
                        </label>
                      );
                    })}
                  </>
                )}
              />
              {form.formState.errors.events ? (
                <p id="events-error" role="alert" className="text-xs text-warning">
                  {form.formState.errors.events.message}
                </p>
              ) : null}
            </fieldset>
            {form.formState.errors.root ? (
              <p role="alert" className="text-sm text-warning">
                {form.formState.errors.root.message}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? <Spinner label="Adding endpoint" /> : null}
              Add endpoint
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A live backend returns each endpoint's signing secret once, at creation.
 * It is shown here and discarded when the dialog closes. Lives in the page, not
 * in the add dialog, because the add button moves once the first endpoint exists.
 */
function SigningSecretDialog({ secret, onClose }: { secret: string | null; onClose: () => void }) {
  return (
    <Dialog open={secret !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Save the signing secret</DialogTitle>
          <DialogDescription>
            Verify the <code className="font-mono text-xs">RealHuman-Signature</code> header of
            every delivery with it. This is the only time it is shown.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg border border-border-strong bg-background p-2 pl-3">
          <code
            className="min-w-0 flex-1 truncate font-mono text-xs"
            data-testid="webhook-signing-secret"
          >
            {secret}
          </code>
          <CopyButton value={secret ?? ""} label="Copy signing secret" />
        </div>
        <p className="flex items-start gap-2 text-xs text-warning">
          <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          Store it with your server&apos;s secrets. Never expose it in browser code.
        </p>
        <DialogFooter className="mt-0">
          <Button onClick={onClose}>I&apos;ve stored it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WebhooksView() {
  const webhooks = useWebhooks();
  const remove = useRemoveWebhook();
  const [signingSecret, setSigningSecret] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Receive verification events on your server as they happen."
        actions={
          webhooks.data && webhooks.data.length > 0 ? (
            <AddEndpointDialog onSigningSecret={setSigningSecret} />
          ) : null
        }
      />
      <SigningSecretDialog secret={signingSecret} onClose={() => setSigningSecret(null)} />
      <MockNotice>
        Endpoints added in mock mode are kept in memory and receive no deliveries.
      </MockNotice>

      {webhooks.isPending ? (
        <LoadingState rows={2} label="Loading endpoints" />
      ) : webhooks.isError ? (
        <ErrorState
          title="Couldn't load endpoints"
          description={toApiError(webhooks.error).message}
          onRetry={() => void webhooks.refetch()}
        />
      ) : webhooks.data.length === 0 ? (
        <EmptyState
          icon={Webhook}
          title="No endpoints configured"
          description={
            <>
              Add an HTTPS endpoint to receive{" "}
              <code className="font-mono text-xs">verification.*</code> events.{" "}
              <Link
                href="/docs#webhooks"
                className="text-foreground underline decoration-border-bright underline-offset-4 hover:decoration-foreground"
              >
                Event reference
              </Link>
            </>
          }
          action={<AddEndpointDialog onSigningSecret={setSigningSecret} />}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {webhooks.data.map((endpoint) => (
            <li
              key={endpoint.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Badge size="sm" tone="accent" dot>
                    {endpoint.status}
                  </Badge>
                  <code className="truncate font-mono text-[13px]">{endpoint.url}</code>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {endpoint.events.map((event) => (
                    <span
                      key={event}
                      className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] text-subtle"
                    >
                      {event}
                    </span>
                  ))}
                </div>
              </div>
              <span className="font-mono text-xs text-subtle">
                {formatUtcDateTime(endpoint.createdAt)}
              </span>
              <ConfirmDialog
                title="Remove this endpoint?"
                description="Events will stop being delivered to this URL."
                confirmLabel="Remove endpoint"
                onConfirm={async () => {
                  try {
                    await remove.mutateAsync(endpoint.id);
                    toast.success("Endpoint removed");
                  } catch (error) {
                    toast.error("Couldn't remove the endpoint", {
                      description: toApiError(error).message,
                    });
                  }
                }}
                trigger={
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${endpoint.url}`}>
                    <Trash2 aria-hidden />
                  </Button>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
