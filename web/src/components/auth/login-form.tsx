"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRoundIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InlineError } from "@/components/ui/states";
import { isApiError } from "@/lib/api/errors";
import { safeNextPath } from "@/lib/auth/auth-provider";
import { useAuth } from "@/lib/auth/hooks";
import { GoogleButton } from "./google-button";

const schema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
  mfaCode: z
    .string()
    .regex(/^\d{6}$/, "Enter the 6-digit code")
    .optional()
    .or(z.literal("")),
});
type Values = z.infer<typeof schema>;

const REASONS: Record<string, string> = {
  session_expired: "Your session expired. Please sign in again.",
  refresh_token_reused: "For your security, this session was ended. Please sign in again.",
  signed_out_elsewhere: "You signed out in another tab.",
  expired: "Your session expired. Please sign in again.",
};

export function LoginForm() {
  const { login, status } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const reason = params.get("reason");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mfaRef = useRef<HTMLInputElement | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "", mfaCode: "" },
  });

  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, router, next]);

  useEffect(() => {
    if (needsMfa) mfaRef.current?.focus();
  }, [needsMfa]);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await login({ email: values.email, password: values.password, mfaCode: values.mfaCode || undefined });
      router.replace(next);
    } catch (err) {
      if (isApiError(err) && err.code === "mfa_required") {
        setNeedsMfa(true);
        return;
      }
      if (isApiError(err) && err.kind === "validation") {
        for (const [field, message] of Object.entries(err.fieldErrors)) {
          if (field === "email" || field === "password") form.setError(field, { message });
        }
      }
      setError(err);
    }
  });

  const { errors, isSubmitting } = form.formState;
  const mfaReg = form.register("mfaCode");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to AgentOS</h1>
        <p className="mt-1.5 text-sm text-fg-muted">Your agents are waiting for their next goal.</p>
      </div>

      {reason && REASONS[reason] && (
        <p
          role="status"
          className="rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-[13px] text-fg-muted"
        >
          {REASONS[reason]}
        </p>
      )}

      <GoogleButton next={next} />

      <div className="flex items-center gap-3 text-2xs tracking-widest text-fg-subtle uppercase">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>

      <form method="post" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="Email" error={errors.email?.message} required>
          {(ids) => <Input type="email" autoComplete="email" inputMode="email" {...ids} {...form.register("email")} />}
        </Field>
        <Field label="Password" error={errors.password?.message} required>
          {(ids) => <Input type="password" autoComplete="current-password" {...ids} {...form.register("password")} />}
        </Field>
        {needsMfa && (
          <Field
            label="Authentication code"
            description="Enter the 6-digit code from your authenticator app."
            error={errors.mfaCode?.message}
            required
          >
            {(ids) => (
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                className="font-mono tracking-[0.3em]"
                {...ids}
                {...mfaReg}
                ref={(el) => {
                  mfaReg.ref(el);
                  mfaRef.current = el;
                }}
              />
            )}
          </Field>
        )}
        {error ? <InlineError error={error} /> : null}
        <Button type="submit" variant="primary" size="lg" loading={isSubmitting} className="w-full">
          {needsMfa ? (
            <>
              <KeyRoundIcon /> Verify and sign in
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>

      <p className="text-center text-sm text-fg-muted">
        New to AgentOS?{" "}
        <Link
          href={`/signup${next !== "/app" ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="text-accent hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
