import React from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  subValue?: string | React.ReactNode;
  icon?: React.ReactNode;
  accent?: boolean;
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  subValue,
  icon,
  accent = false,
  className,
}) => {
  return (
    <div
      className={cn(
        "glass-panel rounded-xl p-5 relative overflow-hidden transition-all duration-300 hover:translate-y-[-2px]",
        accent && "border-amber-500/30 bg-gradient-to-br from-[#12151c] to-[#1a1711]",
        className
      )}
    >
      <div className="flex items-center justify-between text-gray-400 mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
        {icon && <div className="text-gray-400">{icon}</div>}
      </div>
      <div
        className={cn(
          "text-3xl font-bold font-mono tracking-tight",
          accent ? "text-gradient" : "text-white"
        )}
      >
        {value}
      </div>
      {subValue && (
        <div className="mt-2 text-xs text-gray-400 flex items-center gap-1.5">
          {subValue}
        </div>
      )}
    </div>
  );
};
