import { AlertOctagonIcon } from "lucide-react";
import { RequestId } from "@/components/ui/states";
import { normalizeError } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Inline error for a message that is already phrased for people (a backend rule message or a
 * rollout refusal explained with its details). Use `InlineError` for raw thrown values.
 */
export function InlineAlert({ message, error, className }: { message: string; error?: unknown; className?: string }) {
  const requestId = error ? normalizeError(error).requestId : null;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/8 px-3 py-2 text-[13px] text-danger",
        className,
      )}
    >
      <AlertOctagonIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p>{message}</p>
        {requestId && <RequestId id={requestId} className="mt-0.5" />}
      </div>
    </div>
  );
}
