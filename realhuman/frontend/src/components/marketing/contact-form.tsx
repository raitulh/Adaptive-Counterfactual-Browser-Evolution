"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/primitives";
import { apiMode, getApi, toApiError } from "@/lib/api";
import { contactSchema, type ContactValues } from "@/lib/schemas/forms";

/** Loaded on demand when the contact dialog opens (keeps form + schema code off the landing page). */
export default function ContactForm({ plan }: { plan: string }) {
  const [sent, setSent] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: { name: "", email: "", company: "", message: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await getApi().contact.requestAccess(values);
      setSent(true);
    } catch (error) {
      setSubmitError(toApiError(error).message);
    }
  });

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center" role="status">
        <CircleCheck aria-hidden className="size-8 text-accent" />
        <DialogTitle>Request received</DialogTitle>
        <DialogDescription>
          {apiMode === "mock"
            ? "This deployment runs in mock mode, so nothing was sent. With the live API connected, the team would follow up by email."
            : "Thanks — we'll follow up by email."}
        </DialogDescription>
        <DialogClose asChild>
          <Button variant="secondary" className="mt-2">
            Close
          </Button>
        </DialogClose>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <DialogHeader>
        <DialogTitle>Talk to us about {plan}</DialogTitle>
        <DialogDescription>Tell us about your use case and expected volume.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="contact-name" label="Name" error={errors.name?.message}>
            {(control) => <Input {...control} autoComplete="name" {...form.register("name")} />}
          </Field>
          <Field id="contact-email" label="Work email" error={errors.email?.message}>
            {(control) => (
              <Input {...control} type="email" autoComplete="email" {...form.register("email")} />
            )}
          </Field>
        </div>
        <Field id="contact-company" label="Company" hint="Optional" error={errors.company?.message}>
          {(control) => (
            <Input {...control} autoComplete="organization" {...form.register("company")} />
          )}
        </Field>
        <Field
          id="contact-message"
          label="What are you protecting?"
          hint="Optional"
          error={errors.message?.message}
        >
          {(control) => <Textarea {...control} rows={3} {...form.register("message")} />}
        </Field>
        {submitError ? (
          <p role="alert" className="text-sm text-warning">
            {submitError}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Spinner label="Sending" /> : null}
          {isSubmitting ? "Sending…" : "Send request"}
        </Button>
      </DialogFooter>
    </form>
  );
}
