import { Label as LabelPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn("text-[13px] font-medium text-fg", className)} {...props} />
));
Label.displayName = "Label";

interface FieldProps {
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  /** Receives the ids to wire into the control (id, aria-describedby, aria-invalid). */
  children: (ids: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => React.ReactNode;
}

/** Accessible form field: label, description and error message are all linked to the control. */
export function Field({ label, description, error, required, className, children }: FieldProps) {
  const id = React.useId();
  const descId = description ? `${id}-desc` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [descId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <Label htmlFor={id}>
          {label}
          {required && (
            <span className="ml-0.5 text-fg-subtle" aria-hidden>
              *
            </span>
          )}
        </Label>
      )}
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {description && !error && (
        <p id={descId} className="text-xs text-fg-subtle">
          {description}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
