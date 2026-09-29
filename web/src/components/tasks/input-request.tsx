"use client";

/** The task is waiting for information: show the question(s) and send one answer (`POST /tasks/{id}/input`). */
import { zodResolver } from "@hookform/resolvers/zod";
import { MessageSquareTextIcon, SendIcon } from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { InlineError } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { isApiError } from "@/lib/api";
import type { TaskActions } from "./hooks";

const schema = z.object({
  answer: z
    .string()
    .trim()
    .min(1, "Type an answer so AgentOS can continue.")
    .max(4000, "Keep the answer under 4,000 characters."),
});

export const InputRequest = React.forwardRef<HTMLTextAreaElement, { questions: string[]; actions: TaskActions }>(
  function InputRequest({ questions, actions }, ref) {
    const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { answer: "" } });
    const m = actions.provideInput;
    const { ref: registerRef, ...answerField } = form.register("answer");

    const submit = form.handleSubmit(({ answer }) =>
      m.mutate(answer.trim(), {
        onSuccess: () => {
          form.reset();
          toast.success("Thanks — AgentOS is continuing with your answer.");
        },
        onError: (err) => {
          if (isApiError(err) && err.fieldErrors.answer) form.setError("answer", { message: err.fieldErrors.answer });
        },
      }),
    );

    return (
      <section
        aria-labelledby="input-request-title"
        className="rounded-xl border border-warning/35 bg-warning/[0.04] p-4 sm:p-5"
      >
        <div className="flex items-start gap-3">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-warning/35 bg-warning/10 text-warning"
            aria-hidden
          >
            <MessageSquareTextIcon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="input-request-title" className="text-[15px] font-semibold tracking-tight text-fg">
              AgentOS needs your input to continue
            </h2>
            <p className="mt-0.5 text-[13px] text-fg-muted">
              Nothing else runs until you answer. Your answer is used only for this task.
            </p>
          </div>
        </div>
        <ol className="mt-3 flex flex-col gap-1.5">
          {questions.map((q, i) => (
            <li
              key={i}
              className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm leading-relaxed text-fg"
            >
              {questions.length > 1 && <span className="mr-1.5 font-mono text-2xs text-fg-subtle">{i + 1}.</span>}
              {q}
            </li>
          ))}
        </ol>
        <form onSubmit={submit} className="mt-3 flex flex-col gap-2">
          <Field
            label="Your answer"
            error={form.formState.errors.answer?.message}
            description={questions.length > 1 ? "Answer every question in one reply." : undefined}
          >
            {(ids) => (
              <Textarea
                {...ids}
                {...answerField}
                ref={(el) => {
                  registerRef(el);
                  if (typeof ref === "function") ref(el);
                  else if (ref) ref.current = el;
                }}
                rows={3}
                maxLength={4000}
                placeholder="e.g. zoe@example.com"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
            )}
          </Field>
          {m.error && !(isApiError(m.error) && m.error.fieldErrors.answer) ? <InlineError error={m.error} /> : null}
          <div className="flex items-center justify-end gap-3">
            <span className="hidden text-2xs text-fg-subtle sm:inline">Ctrl/⌘ + Enter to send</span>
            <Button type="submit" variant="primary" size="sm" loading={m.isPending}>
              <SendIcon /> Send answer
            </Button>
          </div>
        </form>
      </section>
    );
  },
);
