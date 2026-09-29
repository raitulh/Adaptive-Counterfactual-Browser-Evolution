"use client";

import { Toaster as Sonner, toast } from "sonner";
import { normalizeError } from "@/lib/api/errors";

export function Toaster() {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: "!bg-surface-3 !border !border-line-strong !text-fg !rounded-xl !shadow-float",
          description: "!text-fg-muted",
          actionButton: "!bg-accent !text-fg-on-accent",
          cancelButton: "!bg-surface-4 !text-fg",
        },
      }}
    />
  );
}

/** Toast an API failure with its human message (and request id when present). */
export function toastError(error: unknown, title = "That didn't work") {
  const e = normalizeError(error);
  toast.error(title, {
    description: e.requestId ? `${e.userMessage} (request ${e.requestId.slice(0, 12)})` : e.userMessage,
  });
}

export { toast };
