"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, KeyRoundIcon, LogOutIcon, ShieldCheckIcon, ShieldOffIcon, SmartphoneIcon, XIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/controls";
import { CopyButton } from "@/components/ui/data-display";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ErrorState, InlineError } from "@/components/ui/states";
import { toast, toastError } from "@/components/ui/toaster";
import { authApi, normalizeError, type MeOut } from "@/lib/api";
import { useAuth, useCurrentUser } from "@/lib/auth/hooks";
import { qk } from "@/lib/query/keys";
import { cn } from "@/lib/utils";
import { applyFieldErrors } from "./form-errors";
import { formatSecret, initialMfaState, isCompleteTotp, mfaReducer, normalizeTotp } from "./mfa-machine";
import { PASSWORD_MAX, PASSWORD_MIN, passwordChecks } from "./password";
import { SettingsCard } from "./settings-layout";

export function SecuritySettings() {
  const me = useCurrentUser();
  if (me.error) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  if (!me.data) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-line bg-surface-1 p-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-3 h-3 w-72" />
            <Skeleton className="mt-6 h-9 w-full max-w-md" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <PasswordCard />
      <MfaCard me={me.data} />
      <SignOutEverywhereCard />
    </div>
  );
}

// ------------------------------------------------------------------------------------ password
const passwordSchema = z
  .object({
    current_password: z.string().min(1, "Enter your current password").max(PASSWORD_MAX),
    new_password: z
      .string()
      .min(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters`)
      .max(PASSWORD_MAX, `At most ${PASSWORD_MAX} characters`)
      .refine((v) => passwordChecks(v).classes >= 3, "Mix at least three of: lowercase, uppercase, digits, symbols"),
    confirm_password: z.string(),
  })
  .refine((v) => v.new_password === v.confirm_password, { path: ["confirm_password"], message: "Passwords don't match" })
  .refine((v) => v.new_password !== v.current_password, { path: ["new_password"], message: "Choose a password different from the current one" });
type PasswordValues = z.infer<typeof passwordSchema>;

function PasswordCard() {
  const queryClient = useQueryClient();
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current_password: "", new_password: "", confirm_password: "" },
  });
  const { register, handleSubmit, formState, reset, setError, control } = form;
  const newPassword = useWatch({ control, name: "new_password" });
  const checks = passwordChecks(newPassword ?? "");

  const change = useMutation({
    mutationFn: (v: PasswordValues) => authApi.changePassword({ current_password: v.current_password, new_password: v.new_password }),
    onSuccess: () => {
      reset();
      void queryClient.invalidateQueries({ queryKey: qk.sessions });
      toast.success("Password changed", { description: "Your other sessions were signed out. This session stays signed in." });
    },
    onError: (err) => {
      const e = normalizeError(err);
      if (e.code === "invalid_credentials") {
        setError("current_password", { type: "server", message: "The current password is incorrect." });
        return;
      }
      applyFieldErrors(err, setError, ["current_password", "new_password"]);
    },
  });
  const unmappedError =
    change.error && normalizeError(change.error).code !== "invalid_credentials" && !formState.errors.new_password && !formState.errors.current_password
      ? change.error
      : null;

  return (
    <form onSubmit={handleSubmit((v) => change.mutate(v))} noValidate>
      <SettingsCard
        id="password"
        title="Password"
        description="Changing your password signs out all of your other sessions. You stay signed in here."
        footer={
          <Button type="submit" variant="primary" loading={change.isPending}>
            <KeyRoundIcon /> Change password
          </Button>
        }
      >
        <div className="grid max-w-md gap-5">
          <Field label="Current password" error={formState.errors.current_password?.message}>
            {(ids) => <Input {...ids} type="password" autoComplete="current-password" {...register("current_password")} />}
          </Field>
          <Field label="New password" error={formState.errors.new_password?.message}>
            {(ids) => (
              <div className="flex flex-col gap-2">
                <Input {...ids} type="password" autoComplete="new-password" {...register("new_password")} />
                <ul className="grid gap-1 text-xs sm:grid-cols-2" aria-label="Password requirements">
                  <Requirement met={checks.length}>{PASSWORD_MIN}+ characters</Requirement>
                  <Requirement met={checks.classes >= 3}>3 of: a–z, A–Z, 0–9, symbol ({checks.classes}/4)</Requirement>
                </ul>
              </div>
            )}
          </Field>
          <Field label="Confirm new password" error={formState.errors.confirm_password?.message}>
            {(ids) => <Input {...ids} type="password" autoComplete="new-password" {...register("confirm_password")} />}
          </Field>
          {unmappedError ? <InlineError error={unmappedError} /> : null}
        </div>
      </SettingsCard>
    </form>
  );
}

function Requirement({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li className={cn("flex items-center gap-1.5", met ? "text-success" : "text-fg-subtle")}>
      {met ? <CheckIcon className="size-3.5" aria-hidden /> : <span className="inline-block size-1.5 rounded-full bg-current" aria-hidden />}
      <span>
        {children}
        <span className="sr-only">{met ? " (met)" : " (not met)"}</span>
      </span>
    </li>
  );
}

// ------------------------------------------------------------------------------------ MFA
function MfaCard({ me }: { me: MeOut }) {
  const queryClient = useQueryClient();
  const [state, dispatch] = React.useReducer(mfaReducer, me.mfa_enabled, initialMfaState);
  const [code, setCode] = React.useState("");
  const codeRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    dispatch({ type: "SYNC", enabled: me.mfa_enabled });
  }, [me.mfa_enabled]);

  React.useEffect(() => {
    if (state.phase === "verifying" && !state.submitting) codeRef.current?.focus();
  }, [state]);

  const refreshMe = () => queryClient.invalidateQueries({ queryKey: qk.me });

  async function start() {
    dispatch({ type: "START" });
    setCode("");
    try {
      dispatch({ type: "ENROLLED", enrollment: await authApi.mfaEnroll() });
    } catch (error) {
      dispatch({ type: "ENROLL_FAILED", error });
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (state.phase !== "verifying" || !isCompleteTotp(code)) return;
    dispatch({ type: "SUBMIT" });
    try {
      await authApi.mfaConfirm(state.enrollment.factor_id, code);
      dispatch({ type: "CONFIRMED" });
      setCode("");
      queryClient.setQueryData<MeOut>(qk.me, (prev) => (prev ? { ...prev, mfa_enabled: true } : prev));
      void refreshMe();
      toast.success("Two-step verification is on", { description: "You'll be asked for a code from your authenticator app when you sign in." });
    } catch (error) {
      dispatch({ type: "CODE_REJECTED", error });
      setCode("");
    }
  }

  const enabled = state.phase === "enabled" || state.phase === "disabling";

  return (
    <SettingsCard
      id="mfa"
      title={
        <span className="flex items-center gap-2">
          Two-step verification
          <Badge tone={enabled ? "success" : "neutral"}>{enabled ? "On" : "Off"}</Badge>
        </span>
      }
      description="Require a 6-digit code from an authenticator app (1Password, Google Authenticator, Authy…) in addition to your password when signing in."
      actions={
        state.phase === "disabled" ? (
          <Button variant="primary" size="sm" onClick={() => void start()}>
            <SmartphoneIcon /> Set up authenticator
          </Button>
        ) : state.phase === "enrolling" ? (
          <Button variant="primary" size="sm" loading>
            Preparing…
          </Button>
        ) : enabled ? (
          <Button variant="danger-outline" size="sm" onClick={() => dispatch({ type: "START_DISABLE" })}>
            <ShieldOffIcon /> Turn off
          </Button>
        ) : null
      }
    >
      <div aria-live="polite">
        {state.phase === "disabled" && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-fg-muted">Two-step verification is off. Anyone with your password can sign in.</p>
            {state.error ? <InlineError error={state.error} /> : null}
          </div>
        )}
        {state.phase === "enrolling" && (
          <div className="flex items-center gap-4" aria-busy>
            <Skeleton className="size-44 rounded-lg" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-3 w-36" />
            </div>
          </div>
        )}
        {state.phase === "verifying" && (
          <form onSubmit={(e) => void confirm(e)} className="grid gap-6 md:grid-cols-[auto_minmax(0,1fr)]">
            <div className="flex flex-col items-center gap-2">
              <div className="rounded-xl bg-white p-3" role="img" aria-label="QR code for your authenticator app">
                <QRCodeSVG value={state.enrollment.otpauth_uri} size={168} marginSize={0} level="M" />
              </div>
              <span className="text-2xs text-fg-subtle">Scan with your authenticator app</span>
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <ol className="grid gap-1.5 text-[13px] text-fg-muted">
                <li>
                  <span className="font-medium text-fg">1.</span> Scan the QR code, or enter the key below manually.
                </li>
                <li>
                  <span className="font-medium text-fg">2.</span> Enter the 6-digit code your app shows to finish.
                </li>
              </ol>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-fg-muted" id="mfa-secret-label">
                  Setup key
                </span>
                <div className="flex items-center gap-1 rounded-md border border-line bg-bg px-3 py-2" aria-labelledby="mfa-secret-label">
                  <code className="min-w-0 flex-1 break-all font-mono text-[13px] tracking-wide text-fg">{formatSecret(state.enrollment.secret)}</code>
                  <CopyButton value={state.enrollment.secret} label="Copy setup key" />
                </div>
              </div>
              <Field label="Verification code" error={state.error ? verificationMessage(state.error) : null}>
                {(ids) => (
                  <Input
                    {...ids}
                    ref={codeRef}
                    value={code}
                    onChange={(e) => setCode(normalizeTotp(e.target.value))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    maxLength={7}
                    className="max-w-40 font-mono text-base tracking-[0.3em]"
                    disabled={state.submitting}
                  />
                )}
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary" loading={state.submitting} disabled={!isCompleteTotp(code)}>
                  <ShieldCheckIcon /> Verify and turn on
                </Button>
                <Button type="button" variant="ghost" disabled={state.submitting} onClick={() => dispatch({ type: "CANCEL" })}>
                  <XIcon /> Cancel
                </Button>
              </div>
            </div>
          </form>
        )}
        {enabled && (
          <p className="flex items-center gap-2 text-[13px] text-fg-muted">
            <ShieldCheckIcon className="size-4 text-success" aria-hidden />
            {state.phase === "enabled" && state.justEnabled
              ? "All set. Keep your authenticator app — you'll need it to sign in."
              : "Sign-ins require a code from your authenticator app."}
          </p>
        )}
      </div>
      <DisableMfaDialog
        open={state.phase === "disabling"}
        submitting={state.phase === "disabling" && state.submitting}
        error={state.phase === "disabling" ? state.error : null}
        onCancel={() => dispatch({ type: "CANCEL" })}
        onSubmit={async (disableCode) => {
          dispatch({ type: "SUBMIT" });
          try {
            await authApi.mfaDisable(disableCode);
            dispatch({ type: "DISABLED" });
            queryClient.setQueryData<MeOut>(qk.me, (prev) => (prev ? { ...prev, mfa_enabled: false } : prev));
            void refreshMe();
            toast.success("Two-step verification is off");
          } catch (error) {
            dispatch({ type: "DISABLE_REJECTED", error });
          }
        }}
      />
    </SettingsCard>
  );
}

function verificationMessage(error: unknown): string {
  const e = normalizeError(error);
  if (e.kind === "validation") return "That code didn't match. Codes change every 30 seconds — enter the current one.";
  return e.userMessage;
}

function DisableMfaDialog({
  open,
  submitting,
  error,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  submitting: boolean;
  error: unknown;
  onCancel: () => void;
  onSubmit: (code: string) => Promise<void>;
}) {
  const [code, setCode] = React.useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !submitting) {
          setCode("");
          onCancel();
        }
      }}
    >
      <DialogContent size="sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isCompleteTotp(code)) void onSubmit(code).then(() => setCode(""));
          }}
        >
          <DialogHeader>
            <DialogTitle>Turn off two-step verification?</DialogTitle>
            <DialogDescription>Enter a current code from your authenticator app to confirm. Your account will be protected by your password only.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label="Verification code" error={error ? verificationMessage(error) : null}>
              {(ids) => (
                <Input
                  {...ids}
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(normalizeTotp(e.target.value))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  className="max-w-40 font-mono text-base tracking-[0.3em]"
                  disabled={submitting}
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => {
                setCode("");
                onCancel();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={submitting} disabled={!isCompleteTotp(code)}>
              Turn off
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------ sign out everywhere
function SignOutEverywhereCard() {
  const { logoutAll } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  return (
    <SettingsCard
      title="Sign out everywhere"
      description="Revoke every session on every device, including this one. Use this if a device was lost or you suspect someone else signed in."
      actions={
        <Button variant="danger-outline" size="sm" onClick={() => setOpen(true)}>
          <LogOutIcon /> Sign out everywhere…
        </Button>
      }
    >
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="danger"
        title="Sign out of all devices?"
        description="Every session — including this one — is revoked immediately. You'll need to sign in again everywhere."
        confirmLabel="Sign out everywhere"
        loading={pending}
        onConfirm={async () => {
          setPending(true);
          try {
            await logoutAll();
          } catch (err) {
            toastError(err, "Couldn't sign out everywhere");
            setPending(false);
          }
        }}
      />
    </SettingsCard>
  );
}
