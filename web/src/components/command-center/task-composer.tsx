"use client";

/**
 * The Task Composer. Enter runs, Shift+Enter adds a line, "/" opens commands that insert
 * structured templates ([placeholders] are selected; Tab jumps to the next one). Files can be
 * dropped, pasted or browsed; they upload immediately and are referenced in the task context by
 * file id. One idempotency key per logical submission: retried as-is after an unknown outcome,
 * regenerated after success or any edit.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  CornerDownLeftIcon,
  FileIcon,
  HistoryIcon,
  PaperclipIcon,
  RotateCcwIcon,
  SlashIcon,
  SlidersHorizontalIcon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { tasksApi, type TaskOut } from "@/lib/api";
import { normalizeError } from "@/lib/api/errors";
import { track } from "@/lib/analytics";
import { usePermissions } from "@/lib/auth/hooks";
import { bytes } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { Button } from "@/components/ui/button";
import { Kbd, Progress } from "@/components/ui/controls";
import { Field, Label } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InlineError } from "@/components/ui/states";
import { Tooltip } from "@/components/ui/tooltip";
import { useAgentsIndex } from "@/components/tasks/hooks";
import { fingerprintOf, outcomeUnknown, SubmissionKeyTracker } from "./submission-key";
import {
  applyCommand,
  buildTaskCreate,
  commandById,
  CONTEXT_MAX,
  DURATION_LIMITS,
  hasPlaceholders,
  matchCommands,
  nextPlaceholder,
  PRIORITIES,
  QUICK_ACTIONS,
  slashQuery,
  type SlashCommand,
  type SlashCommandId,
} from "./templates";
import { MAX_ATTACHMENTS, useAttachments } from "./use-attachments";

const GOAL_MAX = 4000;
/** Last focus request handled (UI-only counter shared by composer instances). */
let consumedFocusTick = 0;
const BUILTIN = "__builtin__";

export function TaskComposer({
  className,
  onSubmitted,
}: {
  className?: string;
  onSubmitted?: (task: TaskOut) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can, isLoading: permsLoading } = usePermissions();
  const canCreate = permsLoading || can("tasks:create");
  const focusTick = useUiStore((s) => s.composerFocusTick);
  const agents = useAgentsIndex();
  const recent = useQuery({
    queryKey: qk.tasks.list({ limit: 8 }),
    queryFn: ({ signal }) => tasksApi.list({ limit: 8 }, { signal }),
    enabled: can("tasks:read"),
    staleTime: 15_000,
  });

  const [goal, setGoal] = React.useState("");
  const [context, setContext] = React.useState("");
  const [agentId, setAgentId] = React.useState<string | null>(null);
  const [priority, setPriority] = React.useState(100);
  const [maxDuration, setMaxDuration] = React.useState(0);
  const [advanced, setAdvanced] = React.useState(false);
  const [slash, setSlash] = React.useState<{ query: string; start: number } | null>(null);
  const [active, setActive] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const [hint, setHint] = React.useState<string | null>(null);
  const [started, setStarted] = React.useState<TaskOut | null>(null);
  const dragDepth = React.useRef(0);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const keys = React.useRef(new SubmissionKeyTracker());
  const attachments = useAttachments();
  const ids = { goal: React.useId(), hint: React.useId(), list: React.useId() };

  const create = useMutation({
    mutationFn: ({ body, key }: { body: ReturnType<typeof buildTaskCreate>; key: string }) =>
      tasksApi.create(body, key),
  });

  const body = buildTaskCreate({
    goal,
    context,
    agentId,
    priority,
    maxDurationSeconds: maxDuration || null,
    files: attachments.ready,
  });
  const contextLength = body.context?.length ?? 0;
  const commands = slash ? matchCommands(slash.query) : [];
  const menuOpen = slash !== null && commands.length > 0;
  const failedUploads = attachments.items.some((a) => a.status === "error");
  const blockedReason = !canCreate
    ? "Your role can't create tasks."
    : attachments.uploading
      ? "Waiting for uploads to finish…"
      : failedUploads
        ? "Remove or retry the failed upload first."
        : contextLength > CONTEXT_MAX
          ? `Context is too long (${contextLength}/${CONTEXT_MAX}).`
          : goal.length > GOAL_MAX
            ? `Keep the goal under ${GOAL_MAX} characters.`
            : null;

  // Grow with content.
  React.useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [goal]);

  // The command palette asks the composer to focus — possibly before this page has mounted
  // (it navigates here first), so compare with the last request any composer consumed.
  React.useEffect(() => {
    if (focusTick <= consumedFocusTick) return;
    consumedFocusTick = focusTick;
    textareaRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    textareaRef.current?.focus({ preventScroll: true });
  }, [focusTick]);

  const select = (start: number, end: number) =>
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(start, end);
    });

  const insertTemplate = (id: SlashCommandId) => {
    const cmd = commandById(id);
    const base = goal.trim() ? `${goal.replace(/\s+$/, "")}\n` : "";
    const start = base.length;
    const next = base + cmd.template;
    setGoal(next);
    setSlash(null);
    setHint(null);
    const ph = nextPlaceholder(next, start);
    select(ph?.start ?? next.length, ph?.end ?? next.length);
  };

  const applySlash = (cmd: SlashCommand) => {
    const el = textareaRef.current;
    if (!slash || !el) return;
    const { text, selection } = applyCommand(goal, slash.start, el.selectionStart, cmd);
    setGoal(text);
    setSlash(null);
    select(selection.start, selection.end);
  };

  const updateSlash = (text: string, caret: number) => {
    const q = slashQuery(text, caret);
    setSlash(q);
    if (q) setActive(0);
  };

  const reset = () => {
    setGoal("");
    setContext("");
    setSlash(null);
    setHint(null);
    attachments.clear();
    keys.current.reset();
    create.reset();
  };

  const submit = () => {
    if (create.isPending) return;
    if (!goal.trim()) {
      setHint("Describe what you want done first.");
      textareaRef.current?.focus();
      return;
    }
    if (hasPlaceholders(goal)) {
      setHint("Fill in the [bracketed] parts of the template first — Tab jumps between them.");
      const ph = nextPlaceholder(goal, 0);
      if (ph) select(ph.start, ph.end);
      return;
    }
    if (blockedReason) {
      setHint(blockedReason);
      return;
    }
    setHint(null);
    const key = keys.current.keyFor(fingerprintOf(body));
    create.mutate(
      { body, key },
      {
        onSuccess: (task) => {
          keys.current.succeeded();
          track("task_created", {
            source: "composer",
            has_instructions: Boolean(context.trim()),
            attachments: attachments.ready.length,
            custom_agent: Boolean(agentId),
            priority,
            time_limit: Boolean(maxDuration),
          });
          void queryClient.invalidateQueries({ queryKey: qk.tasks.lists });
          reset();
          setStarted(task);
          onSubmitted?.(task);
          router.push(`/app/tasks/${task.task_id}`);
        },
        onError: (err) => keys.current.failed(err),
      },
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (menuOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i + (e.key === "ArrowDown" ? 1 : commands.length - 1)) % commands.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applySlash(commands[Math.min(active, commands.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlash(null);
        return;
      }
    }
    if (e.key === "Tab" && !e.shiftKey) {
      const el = e.currentTarget;
      const ph = nextPlaceholder(goal, el.selectionEnd);
      // Only jump forward (never wrap), so Tab still leaves the field after the last placeholder.
      if (ph && ph.start >= el.selectionEnd) {
        e.preventDefault();
        select(ph.start, ph.end);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (e.dataTransfer.files.length) attachFiles(e.dataTransfer.files);
  };

  const attachFiles = (files: FileList | File[]) => {
    const list = [...files];
    const accepted = attachments.add(list);
    setHint(
      accepted < list.length
        ? `Up to ${MAX_ATTACHMENTS} files per task — ${list.length - accepted} not attached.`
        : null,
    );
  };

  const recentGoals = React.useMemo(() => {
    const seen = new Set<string>();
    return (recent.data?.items ?? [])
      .map((t) => t.goal.trim())
      .filter((g) => g && !seen.has(g) && (seen.add(g), true))
      .slice(0, 4);
  }, [recent.data]);

  const agentOptions = [...agents.index.values()].filter((a) => a.status === "active" || a.id === agentId);
  const optionSummary = [
    agentId ? `Agent: ${agents.index.get(agentId)?.name ?? "custom"}` : null,
    priority !== 100 ? `${PRIORITIES.find((p) => p.value === priority)?.label} priority` : null,
    maxDuration ? `${DURATION_LIMITS.find((d) => d.value === maxDuration)?.label} limit` : null,
    context.trim() ? "Context added" : null,
  ].filter(Boolean);

  const unknownOutcome = create.error ? outcomeUnknown(create.error) : false;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        className={cn(
          "group/composer relative rounded-2xl border bg-surface-1/90 shadow-panel backdrop-blur-sm transition-[border-color,box-shadow] duration-200",
          "focus-within:border-accent/45 focus-within:shadow-[0_0_0_4px_rgb(92_225_230/0.08),var(--shadow-panel)]",
          dragging ? "border-dashed border-accent/60" : "border-line-strong",
        )}
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={onDrop}
        aria-busy={create.isPending || undefined}
      >
        <label htmlFor={ids.goal} className="sr-only">
          What do you want done?
        </label>
        <textarea
          ref={textareaRef}
          id={ids.goal}
          value={goal}
          rows={2}
          maxLength={GOAL_MAX + 200}
          disabled={create.isPending}
          placeholder="e.g. Schedule a 30-minute meeting with Rahim tomorrow after 2 PM and email him a confirmation"
          aria-describedby={ids.hint}
          aria-autocomplete="list"
          aria-controls={menuOpen ? ids.list : undefined}
          aria-activedescendant={
            menuOpen ? `${ids.list}-${commands[Math.min(active, commands.length - 1)]?.id}` : undefined
          }
          onChange={(e) => {
            setGoal(e.target.value);
            setHint(null);
            setStarted(null);
            updateSlash(e.target.value, e.target.selectionStart);
          }}
          onSelect={(e) => updateSlash(e.currentTarget.value, e.currentTarget.selectionStart)}
          onBlur={() => setTimeout(() => setSlash(null), 120)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              attachFiles(e.clipboardData.files);
            }
          }}
          className="block min-h-[4.5rem] w-full resize-none bg-transparent px-5 pt-4 pb-2 text-[15px] leading-relaxed text-fg outline-none placeholder:text-fg-subtle disabled:opacity-60 sm:text-base"
        />

        {menuOpen && (
          <ul
            id={ids.list}
            role="listbox"
            aria-label="Commands"
            className="absolute top-full right-3 left-3 z-40 mt-1 overflow-hidden rounded-xl border border-line-strong bg-surface-2 p-1 shadow-float sm:right-auto sm:w-96"
          >
            {commands.map((c, i) => (
              <li
                key={c.id}
                id={`${ids.list}-${c.id}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applySlash(c);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2",
                  i === active ? "bg-white/[0.06]" : "",
                )}
              >
                <span className="flex size-7 items-center justify-center rounded-md border border-line-strong bg-surface-3 font-mono text-xs text-accent">
                  /
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-fg">
                    /{c.id} <span className="font-normal text-fg-muted">· {c.label}</span>
                  </span>
                  <span className="block truncate text-xs text-fg-subtle">{c.description}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {attachments.items.length > 0 && (
          <ul className="flex flex-wrap gap-2 px-4 pb-2" aria-label="Attachments">
            {attachments.items.map((a) => (
              <li
                key={a.localId}
                className={cn(
                  "flex max-w-full min-w-0 items-center gap-2 rounded-lg border bg-surface-2 py-1.5 pr-1 pl-2 text-xs sm:max-w-72",
                  a.status === "error" ? "border-danger/40" : "border-line-strong",
                )}
              >
                <FileIcon
                  className={cn("size-3.5 shrink-0", a.status === "error" ? "text-danger" : "text-fg-subtle")}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-fg">{a.file.name}</span>
                  {a.status === "uploading" ? (
                    <Progress
                      value={Math.round(a.progress * 100)}
                      className="mt-1 h-1 w-24"
                      label={`Uploading ${a.file.name}`}
                    />
                  ) : (
                    <span className={cn("block truncate", a.status === "error" ? "text-danger" : "text-fg-subtle")}>
                      {a.status === "error" ? a.error : `${bytes(a.file.size)} · attached`}
                    </span>
                  )}
                </span>
                {a.status === "error" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Retry uploading ${a.file.name}`}
                    onClick={() => attachments.retry(a.localId)}
                  >
                    <RotateCcwIcon />
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={a.status === "uploading" ? `Cancel uploading ${a.file.name}` : `Remove ${a.file.name}`}
                  onClick={() => attachments.remove(a.localId)}
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-1 border-t border-line/70 px-2.5 py-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              if (e.target.files?.length) attachFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Tooltip
            content={attachments.full ? `Up to ${MAX_ATTACHMENTS} files` : "Attach files (or drop / paste them)"}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Attach files"
              disabled={attachments.full || create.isPending}
              onClick={() => fileRef.current?.click()}
            >
              <PaperclipIcon />
            </Button>
          </Tooltip>
          <Tooltip content="Commands">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Insert a command"
              disabled={create.isPending}
              onClick={() => {
                const next = goal.trim() ? `${goal.replace(/\s+$/, "")}\n/` : "/";
                setGoal(next);
                select(next.length, next.length);
                setSlash({ query: "", start: next.length - 1 });
                setActive(0);
              }}
            >
              <SlashIcon />
            </Button>
          </Tooltip>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 px-2 text-xs"
            aria-expanded={advanced}
            aria-controls="composer-advanced"
            onClick={() => setAdvanced((o) => !o)}
          >
            <SlidersHorizontalIcon /> Options
            {optionSummary.length > 0 && <span className="size-1.5 rounded-full bg-accent" aria-label="(customized)" />}
            <ChevronDownIcon className={cn("transition-transform", advanced && "rotate-180")} />
          </Button>
          <p
            id={ids.hint}
            className="ml-1 hidden min-w-0 flex-1 items-center gap-1 truncate text-2xs text-fg-subtle md:flex"
          >
            <Kbd>
              <CornerDownLeftIcon className="size-2.5" />
            </Kbd>
            run
            <span aria-hidden>·</span>
            <Kbd>⇧</Kbd>
            <Kbd>
              <CornerDownLeftIcon className="size-2.5" />
            </Kbd>
            new line
            <span aria-hidden>·</span>
            <Kbd>/</Kbd> commands
          </p>
          <div className="ml-auto flex items-center gap-1.5">
            {(goal || attachments.items.length > 0 || context) && !create.isPending && (
              <Button type="button" variant="ghost" size="sm" className="px-2 text-xs" onClick={reset}>
                Clear
              </Button>
            )}
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="gap-1.5 rounded-lg pl-3"
              loading={create.isPending}
              disabled={!goal.trim() || !canCreate}
              onClick={submit}
              aria-describedby={ids.hint}
            >
              {create.isPending ? "Starting…" : "Run task"}
              {!create.isPending && <ArrowUpIcon />}
            </Button>
          </div>
        </div>

        {dragging && (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-bg/80 text-sm text-accent"
            aria-hidden
          >
            <UploadCloudIcon className="mr-2 size-5" /> Drop files to attach
          </div>
        )}
      </div>

      <div id="composer-advanced" hidden={!advanced} className="rounded-xl border border-line bg-surface-1/70 p-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="composer-agent">Agent</Label>
            <Select value={agentId ?? BUILTIN} onValueChange={(v) => setAgentId(v === BUILTIN ? null : v)}>
              <SelectTrigger id="composer-agent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BUILTIN}>Built-in agent</SelectItem>
                {agentOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                    {a.current_version ? ` · v${a.current_version.version_number}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="composer-priority">Priority</Label>
            <Select value={String(priority)} onValueChange={(v) => setPriority(Number(v))}>
              <SelectTrigger id="composer-priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p.value} value={String(p.value)}>
                    {p.label} — {p.hint}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="composer-limit">Execution limit</Label>
            <Select value={String(maxDuration)} onValueChange={(v) => setMaxDuration(Number(v))}>
              <SelectTrigger id="composer-limit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_LIMITS.map((d) => (
                  <SelectItem key={d.value} value={String(d.value)}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Field
          className="mt-4"
          label="Context (optional)"
          description={`Anything AgentOS should know — preferences, constraints, links. Attached files are referenced here automatically (by file id) so the planner can read them. ${contextLength}/${CONTEXT_MAX}`}
          error={contextLength > CONTEXT_MAX ? `Context is too long (${contextLength}/${CONTEXT_MAX}).` : null}
        >
          {(f) => (
            <Textarea
              {...f}
              rows={3}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="e.g. I prefer mornings; keep e-mails short and friendly."
            />
          )}
        </Field>
      </div>

      {started && !create.error && (
        <p className="flex items-center gap-2 px-1 text-[13px] text-fg-muted" role="status" aria-live="polite">
          <span className="size-1.5 rounded-full bg-accent motion-safe:animate-signal" aria-hidden />
          Task started — opening it…
          <Link href={`/app/tasks/${started.task_id}`} className="text-accent hover:underline">
            Open now
          </Link>
        </p>
      )}

      {(hint || create.error) && (
        <div aria-live="polite">
          {hint && !create.error && <p className="px-1 text-[13px] text-warning">{hint}</p>}
          {create.error ? (
            <div className="flex flex-col gap-1.5">
              <InlineError error={create.error} />
              {normalizeError(create.error).kind === "quota_exceeded" && (
                <p className="px-1 text-xs text-fg-muted">
                  Your plan&apos;s limit was reached — retrying won&apos;t help.{" "}
                  <Link href="/app/billing" className="text-accent hover:underline">
                    See plans and usage
                  </Link>
                </p>
              )}
              {unknownOutcome && (
                <p className="px-1 text-xs text-fg-muted">
                  The request may not have reached AgentOS. Press <Kbd>↵</Kbd> to try again — it is safe and will never
                  create the task twice.
                </p>
              )}
            </div>
          ) : null}
        </div>
      )}

      {!advanced && optionSummary.length > 0 && (
        <p className="px-1 text-xs text-fg-subtle">{optionSummary.join(" · ")}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {QUICK_ACTIONS.map((q) =>
          q.href ? (
            <Link
              key={q.id}
              href={q.href}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface-1/60 px-3 text-[13px] text-fg-muted transition-colors outline-none hover:border-line-strong hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              {q.label}
            </Link>
          ) : (
            <button
              key={q.id}
              type="button"
              onClick={() => {
                insertTemplate(q.id);
                if (q.attach) fileRef.current?.click();
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface-1/60 px-3 text-[13px] text-fg-muted transition-colors outline-none hover:border-line-strong hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              {q.label}
            </button>
          ),
        )}
      </div>

      {recentGoals.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="flex items-center gap-1.5 px-1 text-2xs font-medium tracking-[0.12em] text-fg-subtle uppercase">
            <HistoryIcon className="size-3" aria-hidden /> Recent goals
          </p>
          <ul className="flex flex-col">
            {recentGoals.map((g) => (
              <li key={g}>
                <button
                  type="button"
                  onClick={() => {
                    setGoal(g);
                    setHint(null);
                    select(g.length, g.length);
                  }}
                  className="w-full truncate rounded-md px-1 py-1 text-left text-[13px] text-fg-muted transition-colors outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50"
                  title="Reuse this goal"
                >
                  {g}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
