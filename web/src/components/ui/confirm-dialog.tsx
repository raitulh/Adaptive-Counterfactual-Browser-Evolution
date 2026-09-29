"use client";

import { AlertTriangleIcon } from "lucide-react";
import { AlertDialog as AD } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Input } from "./input";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Extra content (e.g. what will be affected). */
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  /** For destructive actions: the user must type this exact text to enable the confirm button. */
  confirmText?: string;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}

/**
 * Explicit confirmation for dangerous or irreversible operations. Focus starts on Cancel;
 * the confirm button is never the default action for destructive dialogs.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  confirmText,
  loading,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AD.Root open={open} onOpenChange={onOpenChange}>
      <AD.Portal>
        <AD.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <AD.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-surface-2 p-6 shadow-float outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]",
            tone === "danger" ? "border-danger/35" : "border-line-strong",
          )}
        >
          <div className="flex gap-3">
            {tone === "danger" && (
              <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-danger/12 text-danger">
                <AlertTriangleIcon className="size-4.5" aria-hidden />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <AD.Title className="text-base font-semibold tracking-tight text-fg">{title}</AD.Title>
              {description && (
                <AD.Description className="mt-1.5 text-sm leading-relaxed text-fg-muted">{description}</AD.Description>
              )}
            </div>
          </div>
          {children && <div className="mt-4">{children}</div>}
          <ConfirmControls
            confirmText={confirmText}
            confirmLabel={confirmLabel}
            cancelLabel={cancelLabel}
            tone={tone}
            loading={loading}
            onConfirm={onConfirm}
          />
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}

/** Lives inside the dialog content, which unmounts on close — so the typed confirmation resets. */
function ConfirmControls({
  confirmText,
  confirmLabel,
  cancelLabel,
  tone,
  loading,
  onConfirm,
}: Pick<ConfirmDialogProps, "confirmText" | "loading" | "onConfirm"> & {
  confirmLabel: string;
  cancelLabel: string;
  tone: "default" | "danger";
}) {
  const [typed, setTyped] = React.useState("");
  const inputId = React.useId();
  const blocked = confirmText !== undefined && typed.trim() !== confirmText;
  return (
    <>
      {confirmText !== undefined && (
        <div className="mt-4 flex flex-col gap-1.5">
          <label htmlFor={inputId} className="text-xs text-fg-muted">
            Type <span className="font-mono text-fg">{confirmText}</span> to confirm
          </label>
          <Input id={inputId} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
      )}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <AD.Cancel asChild>
          <Button variant="ghost">{cancelLabel}</Button>
        </AD.Cancel>
        <Button
          variant={tone === "danger" ? "danger" : "primary"}
          disabled={blocked}
          loading={loading}
          onClick={async (e) => {
            e.preventDefault();
            await onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </>
  );
}
