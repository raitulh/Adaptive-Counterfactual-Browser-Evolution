"use client";

import { JsonViewer } from "@/components/ui/data-display";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { allowsAdditional, describeSchema } from "./schema-describe";

/**
 * Readable parameter list for a JSON Schema (tool input/output). The raw schema is shown only in
 * developer mode.
 */
export function SchemaView({
  schema,
  emptyText = "This tool takes no parameters.",
  className,
  showRaw,
}: {
  schema: unknown;
  emptyText?: string;
  className?: string;
  /** Force the raw JSON (otherwise it follows developer mode). */
  showRaw?: boolean;
}) {
  const developerMode = useUiStore((s) => s.developerMode);
  const rows = describeSchema(schema);
  const strict = !allowsAdditional(schema);
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {rows.length === 0 ? (
        <p className="text-[13px] text-fg-muted">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface-1">
          {rows.map((row) => (
            <li
              key={row.path}
              className="flex flex-col gap-1 px-3 py-2.5"
              style={{ paddingLeft: `${0.75 + row.depth * 1}rem` }}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-mono text-[13px] text-fg">
                  {row.depth > 0 && (
                    <span className="text-fg-subtle">{row.path.slice(0, row.path.length - row.name.length)}</span>
                  )}
                  {row.name}
                </span>
                <span className="font-mono text-2xs text-info">{row.type}</span>
                {row.required ? (
                  <span className="text-2xs font-medium text-warning">required</span>
                ) : (
                  <span className="text-2xs text-fg-subtle">optional</span>
                )}
                {row.nullable && <span className="text-2xs text-fg-subtle">nullable</span>}
              </div>
              {row.description && <p className="text-xs leading-relaxed text-fg-muted">{row.description}</p>}
              {(row.constraints.length > 0 || row.enumValues || row.defaultValue !== undefined) && (
                <div className="flex flex-wrap gap-1.5 text-2xs text-fg-subtle">
                  {row.enumValues && (
                    <span>
                      one of{" "}
                      {row.enumValues.map((v, i) => (
                        <span key={v}>
                          {i > 0 && ", "}
                          <code className="font-mono text-fg-muted">{v}</code>
                        </span>
                      ))}
                    </span>
                  )}
                  {row.constraints.map((c) => (
                    <span key={c} className="rounded border border-line px-1.5 font-mono">
                      {c}
                    </span>
                  ))}
                  {row.defaultValue !== undefined && (
                    <span>
                      default <code className="font-mono text-fg-muted">{row.defaultValue}</code>
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && strict && <p className="text-2xs text-fg-subtle">Additional parameters are rejected.</p>}
      {(showRaw ?? developerMode) && schema !== null && schema !== undefined && <JsonViewer value={schema} />}
    </div>
  );
}
