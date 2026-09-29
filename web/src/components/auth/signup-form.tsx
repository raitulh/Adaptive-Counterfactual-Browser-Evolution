"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
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

// Mirrors the backend RegisterRequest constraints (email, password 10–256 chars); the backend re-validates.
const schema = z.object({
  displayName: z.string().max(200).optional(),
  email: z.email("Enter a valid email address"),
  password: z.string().min(10, "Use at least 10 characters").max(256),
  organizationName: z.string().max(200).optional(),
});
type Values = z.infer<typeof schema>;

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function SignupForm() {
  const { register: registerAccount, status } = useAuth();
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));
  const [error, setError] = useState<unknown>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { displayName: "", email: "", password: "", organizationName: "" },
  });

  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, router, next]);

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await registerAccount({
        email: v.email,
        password: v.password,
        display_name: v.displayName || null,
        organization_name: v.organizationName || null,
        timezone: detectTimezone(),
      });
      router.replace(next);
    } catch (err) {
      if (isApiError(err) && err.kind === "validation") {
        for (const [field, message] of Object.entries(err.fieldErrors)) {
          const map: Record<string, keyof Values> = {
            email: "email",
            password: "password",
            display_name: "displayName",
            organization_name: "organizationName",
          };
          if (map[field]) form.setError(map[field], { message });
        }
      }
      setError(err);
    }
  });

  const { errors, isSubmitting } = form.formState;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create your AgentOS workspace</h1>
        <p className="mt-1.5 text-sm text-fg-muted">
          Give goals instead of clicking through tools. You stay in control of every action.
        </p>
      </div>
      <GoogleButton next={next} label="Sign up with Google" />
      <div className="flex items-center gap-3 text-2xs tracking-widest text-fg-subtle uppercase">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
      <form method="post" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="Your name" error={errors.displayName?.message}>
          {(ids) => <Input autoComplete="name" {...ids} {...form.register("displayName")} />}
        </Field>
        <Field label="Work email" error={errors.email?.message} required>
          {(ids) => <Input type="email" autoComplete="email" {...ids} {...form.register("email")} />}
        </Field>
        <Field label="Password" description="At least 10 characters." error={errors.password?.message} required>
          {(ids) => <Input type="password" autoComplete="new-password" {...ids} {...form.register("password")} />}
        </Field>
        <Field
          label="Organization name"
          description="Optional — you can rename it later."
          error={errors.organizationName?.message}
        >
          {(ids) => <Input autoComplete="organization" {...ids} {...form.register("organizationName")} />}
        </Field>
        {error ? <InlineError error={error} /> : null}
        <Button type="submit" variant="primary" size="lg" loading={isSubmitting} className="w-full">
          Create account
        </Button>
      </form>
      <p className="text-center text-sm text-fg-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
