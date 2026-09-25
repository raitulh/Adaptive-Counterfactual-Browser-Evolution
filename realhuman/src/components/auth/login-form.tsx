"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button, ButtonArrow } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/primitives";
import { apiMode, getApi, toApiError } from "@/lib/api";
import { loginSchema, signupSchema, type LoginValues } from "@/lib/schemas/forms";

export type AuthMode = "signin" | "signup";

const COPY = {
  signin: {
    title: "Log in",
    description: "Welcome back. Log in to manage keys, sessions and policies.",
    submit: "Log in",
    pending: "Logging in…",
    switchPrompt: "New here?",
    switchLabel: "Create an account",
    switchHref: "/login?mode=signup",
    passwordAutocomplete: "current-password",
    redirect: "/dashboard",
  },
  signup: {
    title: "Create your account",
    description: "Get test API keys and start in mock mode. No credit card required.",
    submit: "Create account",
    pending: "Creating account…",
    switchPrompt: "Already have an account?",
    switchLabel: "Log in",
    switchHref: "/login",
    passwordAutocomplete: "new-password",
    redirect: "/dashboard/api-keys",
  },
} as const;

export function LoginForm({ mode }: { mode: AuthMode }) {
  const copy = COPY[mode];
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  const form = useForm<LoginValues>({
    resolver: zodResolver(mode === "signup" ? signupSchema : loginSchema),
    mode: "onTouched",
    defaultValues: { email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;
  // Stay busy through the redirect so the form can't be submitted twice.
  const busy = isSubmitting || redirecting;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const api = getApi();
      const session =
        mode === "signup" ? await api.auth.signup(values) : await api.auth.login(values);
      toast.success(mode === "signup" ? "Account created" : "Logged in", {
        description: `Signed in to ${session.workspace}.`,
      });
      setRedirecting(true);
      router.push(copy.redirect);
    } catch (error) {
      setFormError(toApiError(error).message);
    }
  });

  return (
    <div className="flex w-full max-w-sm flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="text-sm text-muted">{copy.description}</p>
      </div>

      <form
        onSubmit={onSubmit}
        noValidate
        aria-busy={busy}
        className="flex flex-col gap-5"
        aria-describedby={formError ? "form-error" : undefined}
      >
        {formError ? (
          <div
            id="form-error"
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3 text-sm text-warning"
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {formError}
          </div>
        ) : null}

        <Field id="email" label="Email" error={errors.email?.message}>
          {(control) => (
            <Input
              {...control}
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@company.com"
              {...form.register("email")}
            />
          )}
        </Field>

        <Field
          id="password"
          label="Password"
          error={errors.password?.message}
          hint={mode === "signup" ? "At least 12 characters." : undefined}
        >
          {(control) => (
            <div className="relative">
              <Input
                {...control}
                type={showPassword ? "text" : "password"}
                autoComplete={copy.passwordAutocomplete}
                className="pr-11"
                {...form.register("password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                aria-controls="password"
                className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center rounded-r-lg text-subtle transition-colors hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff aria-hidden className="size-4" />
                ) : (
                  <Eye aria-hidden className="size-4" />
                )}
              </button>
            </div>
          )}
        </Field>

        <Button type="submit" size="lg" disabled={busy} className="mt-1">
          {busy ? <Spinner label={copy.pending} /> : null}
          {busy ? copy.pending : copy.submit}
          {busy ? null : <ButtonArrow />}
        </Button>
      </form>

      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted">
          {copy.switchPrompt}{" "}
          <Link
            href={copy.switchHref}
            className="rounded-sm text-foreground underline decoration-border-bright underline-offset-4 hover:decoration-foreground"
          >
            {copy.switchLabel}
          </Link>
        </p>
        {apiMode === "mock" ? (
          <p className="rounded-lg border border-border bg-surface px-3.5 py-3 text-xs text-subtle">
            Mock mode: no account is created and nothing leaves your browser. Any email and a valid
            password sign you in to the demo workspace.
          </p>
        ) : null}
      </div>
    </div>
  );
}
