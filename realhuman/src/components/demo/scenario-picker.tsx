"use client";

import type { DemoScenario } from "@/lib/api/types";
import { cn } from "@/lib/utils/cn";

const OPTIONS: readonly { value: DemoScenario; label: string }[] = [
  { value: "success", label: "Human pass" },
  { value: "step_up", label: "Step-up" },
  { value: "timeout", label: "Timeout" },
  { value: "network_error", label: "Network error" },
];

interface ScenarioPickerProps {
  value: DemoScenario;
  onChange: (value: DemoScenario) => void;
  className?: string;
}

/** Native radio group styled as a segmented control — fully keyboard accessible. */
export function ScenarioPicker({ value, onChange, className }: ScenarioPickerProps) {
  return (
    <fieldset className={cn("flex flex-col items-center gap-2.5", className)}>
      <legend className="mb-2.5 w-full text-center eyebrow">Simulate a scenario</legend>
      <div className="grid w-full max-w-sm grid-cols-2 gap-1 rounded-xl border border-border bg-surface p-1 sm:flex sm:w-auto sm:max-w-full sm:justify-center">
        {OPTIONS.map((option) => (
          <label key={option.value} className="relative">
            <input
              type="radio"
              name="demo-scenario"
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "flex h-9 cursor-pointer items-center justify-center rounded-lg px-3 text-[13px] font-medium text-subtle transition-colors sm:h-8",
                "peer-checked:bg-surface-overlay peer-checked:text-foreground peer-checked:shadow-subtle hover:text-foreground",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
              )}
            >
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
