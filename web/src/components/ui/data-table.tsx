"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Skeleton } from "./controls";
import { ErrorState } from "./states";

export interface Column<T> {
  id: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  className?: string;
  /** Hide below this breakpoint to keep tables readable on small screens. */
  hideBelow?: "sm" | "md" | "lg";
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: React.ReactNode;
  onRowClick?: (row: T) => void;
  /** Cursor pagination: show "Load more" while the backend reports has_more. */
  hasMore?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  caption?: string;
  className?: string;
}

const hide = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" } as const;

/** Fast, accessible table for dense admin/list views (no 3D, no heavy animation). */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading,
  error,
  onRetry,
  empty,
  onRowClick,
  hasMore,
  onLoadMore,
  isLoadingMore,
  caption,
  className,
}: DataTableProps<T>) {
  if (error && rows.length === 0) return <ErrorState error={error} onRetry={onRetry} />;
  return (
    <div className={cn("overflow-hidden rounded-xl border border-line bg-surface-1", className)}>
      {/* `relative` keeps visually-hidden (absolutely positioned) header text inside the scroll area. */}
      <div className="relative overflow-x-auto">
        <table className="w-full border-collapse text-left text-[13px]">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-line">
              {columns.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className={cn(
                    "h-9 px-4 text-2xs font-medium tracking-wider text-fg-subtle uppercase",
                    c.hideBelow && hide[c.hideBelow],
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              rows.length === 0 &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-b border-line last:border-0">
                  {columns.map((c) => (
                    <td key={c.id} className={cn("px-4 py-3", c.hideBelow && hide[c.hideBelow])}>
                      <Skeleton className="h-4 w-full max-w-40" />
                    </td>
                  ))}
                </tr>
              ))}
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === "Enter") onRowClick(row);
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
                className={cn(
                  "border-b border-line last:border-0",
                  onRowClick &&
                    "cursor-pointer transition-colors outline-none hover:bg-white/[0.025] focus-visible:bg-white/[0.04]",
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.id}
                    className={cn("px-4 py-3 align-middle text-fg", c.hideBelow && hide[c.hideBelow], c.className)}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!isLoading && rows.length === 0 && !error && <div className="border-t border-line">{empty}</div>}
      {hasMore && onLoadMore && (
        <div className="flex justify-center border-t border-line p-2">
          <Button variant="ghost" size="sm" onClick={onLoadMore} loading={isLoadingMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
