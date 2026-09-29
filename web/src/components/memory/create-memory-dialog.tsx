"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { BrainCircuitIcon } from "lucide-react";
import * as React from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  InlineError,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from "@/components/ui";
import { memoryTypeValues, newIdempotencyKey, type MemoryCreate, type MemoryType } from "@/lib/api";
import { isApiError } from "@/lib/api/errors";
import { useCreateMemory } from "./hooks";
import { PRIMARY_SECTIONS, SECONDARY_SECTIONS, metaForType } from "./presentation";

// Mirrors backend MemoryCreate (content 1–2000, importance 0–1, subject_key ≤ 200, expires_at in the future).
const schema = z.object({
  content: z.string().trim().min(1, "Tell AgentOS what to remember.").max(2000, "Keep it under 2,000 characters."),
  memory_type: z.enum(memoryTypeValues as [MemoryType, ...MemoryType[]]),
  importance: z.number().min(0).max(1),
  subject_key: z.string().trim().max(200, "Keep the subject key under 200 characters."),
  expires_at: z
    .string()
    .refine((v) => !v || new Date(v).getTime() > Date.now(), "Choose a time in the future.")
    .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), "Enter a valid date and time."),
});
type Values = z.infer<typeof schema>;

const FIELD_MAP: Record<string, keyof Values> = {
  content: "content",
  memory_type: "memory_type",
  importance: "importance",
  subject_key: "subject_key",
  expires_at: "expires_at",
};

export function CreateMemoryDialog({
  open,
  onOpenChange,
  defaultType = "long_term",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultType?: MemoryType;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {/* Mounted only while open: every opening is a fresh logical submission. */}
        {open && <CreateMemoryForm defaultType={defaultType} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CreateMemoryForm({ defaultType, onDone }: { defaultType: MemoryType; onDone: () => void }) {
  const create = useCreateMemory();
  const [error, setError] = React.useState<unknown>(null);
  /** One idempotency key per logical submission; reused when the same body is retried. */
  const attempt = React.useRef<{ body: string; key: string } | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { content: "", memory_type: defaultType, importance: 0.7, subject_key: "", expires_at: "" },
  });
  const type = useWatch({ control: form.control, name: "memory_type" });
  const importance = useWatch({ control: form.control, name: "importance" });
  const content = useWatch({ control: form.control, name: "content" });

  async function submit(v: Values) {
    setError(null);
    const body: MemoryCreate = {
      content: v.content.trim(),
      memory_type: v.memory_type,
      importance: Math.round(v.importance * 100) / 100,
      subject_key: v.subject_key.trim() || null,
      expires_at: v.expires_at ? new Date(v.expires_at).toISOString() : null,
    };
    const serialized = JSON.stringify(body);
    if (!attempt.current || attempt.current.body !== serialized)
      attempt.current = { body: serialized, key: newIdempotencyKey() };
    try {
      const memory = await create.mutateAsync({ body, idempotencyKey: attempt.current.key });
      const reinforced = Date.parse(memory.created_at) < Date.now() - 60_000;
      toast.success(reinforced ? "AgentOS already knew this" : "Remembered", {
        description: reinforced
          ? "The existing memory was reinforced and marked fresh."
          : memory.status === "conflicted"
            ? "Saved, but it conflicts with another memory about the same subject."
            : `Saved as ${metaForType(memory.memory_type).label.toLowerCase()} memory.`,
      });
      onDone();
    } catch (err) {
      if (isApiError(err) && err.kind === "validation") {
        for (const [field, message] of Object.entries(err.fieldErrors)) {
          if (FIELD_MAP[field]) form.setError(FIELD_MAP[field], { message });
        }
      }
      setError(err);
    }
  }

  const { errors, isSubmitting } = form.formState;
  const typeMeta = metaForType(type);

  return (
    <form onSubmit={(e) => void form.handleSubmit(submit)(e)} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <div className="mb-1 flex size-9 items-center justify-center rounded-lg border border-line-strong bg-surface-3 text-accent">
          <BrainCircuitIcon className="size-4.5" aria-hidden />
        </div>
        <DialogTitle>Remember something</DialogTitle>
        <DialogDescription>
          Things you tell AgentOS directly are trusted most (100% confidence) and replace older values for the same
          subject. Never store passwords or other secrets — they&apos;re refused.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-5">
        <Field label="What should AgentOS remember?" required error={errors.content?.message}>
          {(ids) => (
            <div className="relative">
              <Textarea
                {...ids}
                {...form.register("content")}
                rows={4}
                autoFocus
                placeholder="e.g. I prefer 30-minute meetings before noon."
                className="pb-6"
              />
              <span
                className="pointer-events-none absolute right-3 bottom-2 text-2xs text-fg-subtle tabular-nums"
                aria-hidden
              >
                {content.length}/2000
              </span>
            </div>
          )}
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Type" description={typeMeta.description} error={errors.memory_type?.message}>
            {(ids) => (
              <Controller
                control={form.control}
                name="memory_type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={(v) => field.onChange(v as MemoryType)}>
                    <SelectTrigger {...ids} onBlur={field.onBlur}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {PRIMARY_SECTIONS.map((t) => (
                          <SelectItem key={t} value={t}>
                            {metaForType(t).label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel>Short-lived</SelectLabel>
                        {SECONDARY_SECTIONS.map((t) => (
                          <SelectItem key={t} value={t}>
                            {metaForType(t).label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </Field>

          <Field
            label={
              <span className="flex w-full items-center justify-between">
                Importance{" "}
                <span className="font-mono text-xs text-fg-muted tabular-nums">{Math.round(importance * 100)}%</span>
              </span>
            }
            description="How useful this is for future tasks. Higher ranks first when recalled."
            error={errors.importance?.message}
          >
            {(ids) => (
              <Controller
                control={form.control}
                name="importance"
                render={({ field }) => (
                  <input
                    {...ids}
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={field.value}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                    onBlur={field.onBlur}
                    aria-valuetext={`${Math.round(field.value * 100)}%`}
                    className="mt-2 h-1.5 w-full cursor-pointer accent-accent"
                  />
                )}
              />
            )}
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Subject key"
            description="Optional. Memories with the same key are checked for conflicts, e.g. pref:meeting_length."
            error={errors.subject_key?.message}
          >
            {(ids) => (
              <Input
                {...ids}
                {...form.register("subject_key")}
                placeholder="contact:rahim:email"
                className="font-mono text-[13px]"
                autoComplete="off"
              />
            )}
          </Field>
          <Field
            label="Forget after"
            description="Optional. AgentOS stops using it after this time."
            error={errors.expires_at?.message}
          >
            {(ids) => <Input {...ids} {...form.register("expires_at")} type="datetime-local" />}
          </Field>
        </div>

        {error !== null && !(isApiError(error) && Object.keys(error.fieldErrors).some((f) => FIELD_MAP[f])) && (
          <InlineError error={error} />
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={isSubmitting}>
          Remember
        </Button>
      </DialogFooter>
    </form>
  );
}
