"use client";

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LoadingState } from "@/components/ui/states";

const ContactForm = dynamic(() => import("@/components/marketing/contact-form"), {
  ssr: false,
  loading: () => (
    <>
      <DialogTitle className="sr-only">Loading form</DialogTitle>
      <DialogDescription className="sr-only">The contact form is loading.</DialogDescription>
      <LoadingState rows={3} label="Loading form" />
    </>
  ),
});

interface ContactDialogProps {
  plan: string;
  trigger: ReactNode;
}

export function ContactDialog({ plan, trigger }: ContactDialogProps) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {/* The form (and its validation schema) mounts only while open, so it also resets on close. */}
      <DialogContent>{open ? <ContactForm plan={plan} /> : null}</DialogContent>
    </Dialog>
  );
}
