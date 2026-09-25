import type { ReactNode } from "react";

export function DocsSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-5 border-t border-border pt-12 first:border-t-0 first:pt-0"
    >
      <h2 id={`${id}-title`} className="text-2xl font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function DocsTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: readonly string[];
  rows: readonly (readonly ReactNode[])[];
}) {
  return (
    <div
      className="relative overflow-x-auto rounded-xl border border-border"
      tabIndex={0}
      role="region"
      aria-label={caption}
    >
      <table className="w-full min-w-[34rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface text-xs text-subtle">
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col" className="px-4 py-2.5 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className="px-4 py-3 align-top text-muted first:text-foreground"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-[5px] border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[0.8125em] text-foreground">
      {children}
    </code>
  );
}

export function Endpoint({
  method,
  path,
  auth,
  children,
}: {
  method: "GET" | "POST" | "DELETE";
  path: string;
  auth: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-md border border-accent/25 bg-accent/10 px-2 py-0.5 font-mono text-xs text-accent">
          {method}
        </span>
        <code className="font-mono text-sm">{path}</code>
        <span className="ml-auto text-xs text-subtle">{auth}</span>
      </div>
      <div className="flex flex-col gap-3 text-sm text-muted">{children}</div>
    </div>
  );
}
