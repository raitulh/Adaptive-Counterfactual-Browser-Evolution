"use client";

import * as React from "react";
import { Switch } from "@/components/ui/controls";
import { Field } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  permissionLevelValues,
  riskLevelValues,
  type McpToolOut,
  type PermissionLevel,
  type RiskLevel,
} from "@/lib/api";
import { permissionLevelMeta, riskLevelMeta } from "@/lib/status";
import { cn } from "@/lib/utils";

export interface GovernanceValues {
  permission_level: PermissionLevel;
  risk_level: RiskLevel;
  requires_approval: boolean;
}

export function governanceOf(tool: McpToolOut): GovernanceValues {
  return {
    permission_level: tool.permission_level,
    risk_level: tool.risk_level,
    requires_approval: tool.requires_approval,
  };
}

/** Changed fields only (PATCH semantics). */
export function governanceDiff(tool: McpToolOut, v: GovernanceValues): Partial<GovernanceValues> {
  const out: Partial<GovernanceValues> = {};
  if (v.permission_level !== tool.permission_level) out.permission_level = v.permission_level;
  if (v.risk_level !== tool.risk_level) out.risk_level = v.risk_level;
  if (v.requires_approval !== tool.requires_approval) out.requires_approval = v.requires_approval;
  return out;
}

/** Server hints (MCP annotations) → a suggestion only; the admin decides. */
export function hintSummary(annotations: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (annotations.readOnlyHint === true) out.push("claims to be read-only");
  if (annotations.readOnlyHint === false) out.push("claims to modify data");
  if (annotations.destructiveHint === true) out.push("claims to be destructive");
  if (annotations.destructiveHint === false) out.push("claims to be non-destructive");
  if (annotations.idempotentHint === true) out.push("claims to be idempotent");
  if (annotations.openWorldHint === true) out.push("claims to reach external systems");
  if (annotations.openWorldHint === false) out.push("claims a closed domain");
  return out;
}

/** Admin-assigned permission level, risk and approval requirement for an MCP tool. */
export function GovernanceFields({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: GovernanceValues;
  onChange: (v: GovernanceValues) => void;
  disabled?: boolean;
  /** Two columns with the approval switch below (for narrow side panels). */
  compact?: boolean;
}) {
  const approvalId = React.useId();
  return (
    <div className={cn("grid gap-4", compact ? "grid-cols-2 [&>*:last-child]:col-span-2" : "sm:grid-cols-3")}>
      <Field label="Permission level" description={permissionLevelMeta[value.permission_level].description}>
        {(ids) => (
          <Select
            value={value.permission_level}
            onValueChange={(v) => onChange({ ...value, permission_level: v as PermissionLevel })}
            disabled={disabled}
          >
            <SelectTrigger {...ids}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {permissionLevelValues.map((p) => (
                <SelectItem key={p} value={p}>
                  {permissionLevelMeta[p].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <Field label="Risk" description={riskLevelMeta[value.risk_level].description}>
        {(ids) => (
          <Select
            value={value.risk_level}
            onValueChange={(v) => onChange({ ...value, risk_level: v as RiskLevel })}
            disabled={disabled}
          >
            <SelectTrigger {...ids}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {riskLevelValues.map((r) => (
                <SelectItem key={r} value={r}>
                  {riskLevelMeta[r].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={approvalId} className="text-[13px] font-medium text-fg">
          Require approval
        </label>
        <div className="flex h-9 items-center">
          <Switch
            id={approvalId}
            checked={value.requires_approval}
            onCheckedChange={(c) => onChange({ ...value, requires_approval: c })}
            disabled={disabled}
            aria-describedby={`${approvalId}-d`}
          />
        </div>
        <p id={`${approvalId}-d`} className="text-xs text-fg-subtle">
          Every call waits for a person. High-risk writes, and any side effect at high or critical risk, need approval
          regardless.
        </p>
      </div>
    </div>
  );
}
