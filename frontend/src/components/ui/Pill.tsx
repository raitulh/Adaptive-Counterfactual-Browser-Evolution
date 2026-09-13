import React from "react";
import { cn } from "@/lib/utils";

export type PillVariant =
  | "default"
  | "promote"
  | "promoted"
  | "reject"
  | "rejected"
  | "warning"
  | "info"
  | "draft"
  | "experimental"
  | "retired"
  | "validated";

interface PillProps {
  text?: string;
  children?: React.ReactNode;
  variant?: PillVariant;
  className?: string;
}

export const Pill: React.FC<PillProps> = ({ text, children, variant, className }) => {
  const content = children || text;
  const normalized = (variant || (typeof content === "string" ? content : "") || "").toLowerCase();

  let colorClasses = "bg-surface-subtle text-gray-300 border-surface-border";
  if (normalized.includes("promote") || normalized.includes("validated") || normalized.includes("success")) {
    colorClasses = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  } else if (
    normalized.includes("reject") ||
    normalized.includes("rollback") ||
    normalized.includes("fail") ||
    normalized.includes("retired")
  ) {
    colorClasses = "bg-rose-500/10 text-rose-400 border-rose-500/20";
  } else if (
    normalized.includes("more_data") ||
    normalized.includes("candidate") ||
    normalized.includes("info")
  ) {
    colorClasses = "bg-sky-500/10 text-sky-400 border-sky-500/20";
  } else if (normalized.includes("draft") || normalized.includes("experimental") || normalized.includes("warning")) {
    colorClasses = "bg-amber-500/10 text-amber-400 border-amber-500/20";
  }

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-mono font-medium border",
        colorClasses,
        className
      )}
    >
      {content}
    </span>
  );
};
