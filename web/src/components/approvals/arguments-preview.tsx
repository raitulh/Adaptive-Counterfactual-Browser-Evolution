/**
 * Readable key/value rendering of an approval's `arguments_preview` (never raw JSON): humanized
 * keys, formatted dates, lists as chips, long text preserved, empty values summarized.
 */
import { dateTime, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

function Value({ value, depth }: { value: unknown; depth: number }) {
  if (typeof value === "string") {
    if (ISO_DATE.test(value)) {
      return (
        <time dateTime={value} className="tabular-nums" title={value}>
          {dateTime(value)}
        </time>
      );
    }
    if (value.includes("\n") || value.length > 120) {
      return (
        <p className="rounded-md border border-line bg-bg/60 px-2.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-fg">
          {value}
        </p>
      );
    }
    return <span className="break-words">{value}</span>;
  }
  if (typeof value === "number") return <span className="tabular-nums">{value}</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string" || typeof v === "number")) {
      return (
        <span className="flex flex-wrap gap-1">
          {value.map((v, i) => (
            <span key={i} className="rounded-md border border-line-strong bg-surface-2 px-1.5 py-px text-xs text-fg">
              {String(v)}
            </span>
          ))}
        </span>
      );
    }
    return (
      <div className="flex flex-col gap-1.5">
        {value.map((v, i) => (
          <Value key={i} value={v} depth={depth + 1} />
        ))}
      </div>
    );
  }
  if (value && typeof value === "object") {
    if (depth > 3) return <span className="text-fg-subtle">…</span>;
    return (
      <ArgumentsPreview
        args={value as Record<string, unknown>}
        depth={depth + 1}
        className="rounded-md border border-line bg-bg/40 p-2"
      />
    );
  }
  return <span className="text-fg-subtle">—</span>;
}

export function ArgumentsPreview({
  args,
  depth = 0,
  className,
}: {
  args: Record<string, unknown>;
  depth?: number;
  className?: string;
}) {
  const entries = Object.entries(args ?? {});
  const shown = entries.filter(([, v]) => !isEmpty(v));
  const empty = entries.length - shown.length;
  if (entries.length === 0) return <p className="text-xs text-fg-subtle">No arguments.</p>;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)]">
        {shown.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-fg-subtle sm:pt-px">{humanize(k)}</dt>
            <dd className="min-w-0 text-fg">
              <Value value={v} depth={depth} />
            </dd>
          </div>
        ))}
      </dl>
      {empty > 0 && depth === 0 && (
        <p className="text-2xs text-fg-subtle">
          {empty} empty field{empty === 1 ? "" : "s"} not shown
        </p>
      )}
    </div>
  );
}
