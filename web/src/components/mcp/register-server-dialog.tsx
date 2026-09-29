"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { EyeIcon, EyeOffIcon, LockIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InlineError } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { newIdempotencyKey } from "@/lib/api";
import { isApiError } from "@/lib/api/errors";
import { useRegisterMcpServer } from "./queries";
import { REGISTER_FIELD_MAP, registerServerDefaults, registerServerSchema, toRegisterPayload, type RegisterServerValues } from "./register-schema";

/** Human explanation for the gateway's egress refusals (422 unsafe_url). */
export function describeUnsafeUrl(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("port")) return "The gateway only connects to ports 80, 443, 8080 and 8443 unless the host is on the operator's MCP allowlist (MCP_ALLOWED_HOSTS).";
  if (m.includes("private") || m.includes("reserved"))
    return "The URL resolves to a private or reserved address. Operators can allow specific internal hosts with MCP_ALLOWED_HOSTS.";
  if (m.includes("metadata")) return "Cloud metadata endpoints are never allowed.";
  if (m.includes("https")) return "MCP servers must use https in this environment.";
  return "The URL is not allowed by the gateway's egress policy.";
}

export function RegisterServerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const register = useRegisterMcpServer();
  const [error, setError] = React.useState<unknown>(null);
  const [reveal, setReveal] = React.useState(false);
  // One key per logical submission: reused if the same values are retried after a failure.
  const [attempt, setAttempt] = React.useState<{ key: string; fingerprint: string } | null>(null);
  const form = useForm<RegisterServerValues>({ resolver: zodResolver(registerServerSchema), defaultValues: registerServerDefaults, mode: "onTouched" });
  const name = useWatch({ control: form.control, name: "name" });
  const secret = useWatch({ control: form.control, name: "authHeaderValue" });
  const { errors } = form.formState;

  const close = (o: boolean) => {
    if (register.isPending) return;
    onOpenChange(o);
    if (!o) {
      form.reset(registerServerDefaults);
      setError(null);
      setReveal(false);
      setAttempt(null);
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const body = toRegisterPayload(values);
    const fingerprint = JSON.stringify(body);
    let current = attempt;
    if (!current || current.fingerprint !== fingerprint) {
      current = { key: newIdempotencyKey(), fingerprint };
      setAttempt(current);
    }
    try {
      const server = await register.mutateAsync({ body, idempotencyKey: current.key });
      toast.success(`${server.name} registered`, { description: "It is pending review. Approve it to sync its tools." });
      close(false);
      router.push(`/app/mcp/${server.id}`);
    } catch (err) {
      if (isApiError(err)) {
        if (err.kind === "validation") {
          for (const [loc, message] of Object.entries(err.fieldErrors)) {
            const field = REGISTER_FIELD_MAP[loc];
            if (field) form.setError(field, { message });
          }
          if (err.code === "unsafe_url") form.setError("url", { message: `${err.message}. ${describeUnsafeUrl(err.message)}` });
        }
        if (err.kind === "conflict" && err.message.toLowerCase().includes("name")) form.setError("name", { message: err.message });
        // A validation/conflict answer is final for these values: the next attempt is a new submission.
        if (err.kind === "validation" || err.kind === "conflict") setAttempt(null);
      }
      setError(err);
    }
  });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="lg">
        <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Register MCP server</DialogTitle>
            <DialogDescription>
              The server is stored as <span className="text-fg">pending review</span>. AgentOS does not contact it or expose any of its tools until an
              admin approves it and enables individual tools.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            <div className="grid gap-5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
              <Field
                label="Name"
                required
                error={errors.name?.message}
                description={
                  <>
                    Tools are named <code className="font-mono">mcp.{name || "name"}.tool</code>
                  </>
                }
              >
                {(ids) => <Input {...ids} {...form.register("name")} autoFocus autoComplete="off" spellCheck={false} placeholder="crm" className="font-mono" />}
              </Field>
              <Field label="Endpoint URL" required error={errors.url?.message} description="Streamable HTTP endpoint, e.g. https://mcp.example.com/mcp">
                {(ids) => <Input {...ids} {...form.register("url")} type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://" className="font-mono text-[13px]" />}
              </Field>
            </div>

            <fieldset className="flex flex-col gap-3 rounded-xl border border-line p-4">
              <legend className="flex items-center gap-1.5 px-1 text-[13px] font-medium text-fg">
                <LockIcon className="size-3.5 text-fg-subtle" aria-hidden /> Authentication <span className="font-normal text-fg-subtle">(optional)</span>
              </legend>
              <p className="-mt-1 text-xs text-fg-muted">
                Sent as a request header on every call. The value is encrypted at rest, write-only, and never shown again. To change it, delete and re-register the server.
              </p>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                <Field label="Header name" error={errors.authHeaderName?.message}>
                  {(ids) => <Input {...ids} {...form.register("authHeaderName")} autoComplete="off" spellCheck={false} className="font-mono text-[13px]" />}
                </Field>
                <Field label="Header value" error={errors.authHeaderValue?.message} description={secret ? `${secret.length} characters` : "e.g. Bearer <token>"}>
                  {(ids) => (
                    <div className="relative">
                      <Input
                        {...ids}
                        {...form.register("authHeaderValue")}
                        type={reveal ? "text" : "password"}
                        autoComplete="new-password"
                        spellCheck={false}
                        className="pr-10 font-mono text-[13px]"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="absolute right-1 top-1"
                        aria-label={reveal ? "Hide header value" : "Show header value"}
                        aria-pressed={reveal}
                        onClick={() => setReveal((r) => !r)}
                      >
                        {reveal ? <EyeOffIcon /> : <EyeIcon />}
                      </Button>
                    </div>
                  )}
                </Field>
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Call timeout" error={errors.timeoutSeconds?.message} description="0.5–120 seconds. Empty uses the platform default.">
                {(ids) => (
                  <div className="relative">
                    <Input {...ids} {...form.register("timeoutSeconds")} inputMode="decimal" placeholder="Default" className="pr-12 font-mono tabular-nums placeholder:font-sans" />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-fg-subtle" aria-hidden>
                      sec
                    </span>
                  </div>
                )}
              </Field>
              <Field label="Rate limit" error={errors.rateLimitPerMinute?.message} description="Calls per minute to this server (1–600), including syncs.">
                {(ids) => (
                  <div className="relative">
                    <Input {...ids} {...form.register("rateLimitPerMinute")} inputMode="numeric" className="pr-16 font-mono tabular-nums" />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-fg-subtle" aria-hidden>
                      / min
                    </span>
                  </div>
                )}
              </Field>
            </div>
            <p className="text-xs text-fg-subtle">
              Transport: <span className="font-mono text-fg-muted">streamable_http</span> — the only transport offered; stdio would run tenant-chosen processes on AgentOS workers.
            </p>
            {error !== null && <InlineError error={error} />}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={register.isPending}>
              Register server
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
