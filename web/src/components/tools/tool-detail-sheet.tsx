"use client";

import { ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";
import { Badge, PermissionBadge, RiskBadge } from "@/components/ui/badge";
import { KeyValue } from "@/components/ui/data-display";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/drawer";
import { Tooltip } from "@/components/ui/tooltip";
import type { ToolOut, ToolRuleOut } from "@/lib/api";
import { permissionLevelMeta, riskLevelMeta } from "@/lib/status";
import { capabilityForScope, shortScope } from "@/components/integrations/google-capabilities";
import { ROLE_OPTIONS, ruleEffectMeta, rulesForTool } from "./policy-schema";
import { SchemaView } from "./schema-view";
import { ToolConnectionStatus } from "./tool-connection";
import { asPermissionLevel, asRiskLevel, categoryLabel, outputTrust, providerLabel, verificationMethodMeta } from "./tool-meta";

function SheetSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-2xs font-medium uppercase tracking-wider text-fg-subtle">{title}</h3>
      {children}
    </section>
  );
}

export function ApprovalBadge({ tool }: { tool: Pick<ToolOut, "requires_approval" | "available_to_you"> }) {
  if (!tool.available_to_you) {
    return (
      <Badge tone="danger">
        <ShieldAlertIcon className="size-3" aria-hidden /> Blocked for you
      </Badge>
    );
  }
  return tool.requires_approval ? (
    <Badge tone="warning">
      <ShieldAlertIcon className="size-3" aria-hidden /> Approval required
    </Badge>
  ) : (
    <Badge tone="neutral" variant="outline">
      <ShieldCheckIcon className="size-3" aria-hidden /> Runs without approval
    </Badge>
  );
}

export function ToolDetailSheet({ tool, rules, onOpenChange }: { tool: ToolOut | null; rules?: ToolRuleOut[]; onOpenChange: (open: boolean) => void }) {
  const level = tool ? asPermissionLevel(tool.permission_level) : null;
  const risk = tool ? asRiskLevel(tool.risk_level) : null;
  const trust = tool ? outputTrust(tool.output_trust) : null;
  const applicable = tool && rules ? rulesForTool(tool.name, rules) : [];
  return (
    <Sheet open={tool !== null} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-xl">
        {tool && (
          <>
            <div className="border-b border-line px-5 pb-4 pt-5 pr-12">
              <SheetTitle className="font-mono text-base font-semibold text-fg">{tool.name}</SheetTitle>
              <SheetDescription className="mt-1 text-sm leading-relaxed text-fg-muted">{tool.description}</SheetDescription>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {level && <PermissionBadge level={level} />}
                {risk && <RiskBadge level={risk} />}
                <ApprovalBadge tool={tool} />
                <ToolConnectionStatus tool={tool} />
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
              <SheetSection title="Effective decision for you">
                <p className="text-[13px] leading-relaxed text-fg-muted">
                  {!tool.available_to_you
                    ? "The permission engine denies this tool for your role in this organization."
                    : tool.requires_approval
                      ? "Agents may plan this tool, but each call waits for a person to approve it."
                      : "Agents may call this tool without an approval step (organization rules and agent tool policies can still restrict it)."}
                </p>
                {tool.policy_reasons && tool.policy_reasons.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {tool.policy_reasons.map((r) => (
                      <li key={r} className="rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 text-xs text-fg-muted">
                        {r}
                      </li>
                    ))}
                  </ul>
                )}
              </SheetSection>

              <SheetSection title="Specification">
                <KeyValue
                  items={[
                    ["Provider", providerLabel(tool.provider)],
                    ["Category", categoryLabel(tool.category)],
                    ["Version", <span key="v" className="font-mono text-xs">{tool.version}</span>],
                    ["Permission level", level ? `${permissionLevelMeta[level].label} — ${permissionLevelMeta[level].description}` : tool.permission_level],
                    ["Risk", risk ? `${riskLevelMeta[risk].label} — ${riskLevelMeta[risk].description}` : tool.risk_level],
                    [
                      "Verification",
                      <span key="ver">
                        {verificationMethodMeta[tool.verification_method]?.label ?? tool.verification_method}
                        {verificationMethodMeta[tool.verification_method] && (
                          <span className="block text-xs text-fg-muted">{verificationMethodMeta[tool.verification_method].description}</span>
                        )}
                      </span>,
                    ],
                    [
                      "Output trust",
                      <span key="trust">
                        {trust?.label}
                        {trust?.description && <span className="block text-xs text-fg-muted">{trust.description}</span>}
                      </span>,
                    ],
                  ]}
                />
              </SheetSection>

              {tool.required_scopes.length > 0 && (
                <SheetSection title="Required OAuth scopes">
                  <ul className="flex flex-col gap-1.5">
                    {tool.required_scopes.map((s) => {
                      const cap = capabilityForScope(s);
                      return (
                        <li key={s} className="flex flex-wrap items-center gap-2 text-[13px]">
                          <Tooltip content={<span className="font-mono">{s}</span>}>
                            <code tabIndex={0} className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg outline-none">
                              {shortScope(s)}
                            </code>
                          </Tooltip>
                          {cap && (
                            <span className="text-xs text-fg-muted">
                              granted by capability <span className="font-mono text-fg">{cap.id}</span>
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </SheetSection>
              )}

              {rules && (
                <SheetSection title="Organization rules that match">
                  {applicable.length === 0 ? (
                    <p className="text-[13px] text-fg-muted">No organization rule matches this tool; built-in defaults apply.</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {applicable.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                          <Badge tone={ruleEffectMeta[r.effect].tone}>{ruleEffectMeta[r.effect].label}</Badge>
                          <code className="font-mono text-xs text-fg">{r.tool_pattern}</code>
                          <span className="text-xs text-fg-subtle">
                            {r.role ? `for ${ROLE_OPTIONS.find((o) => o.value === r.role)?.label.toLowerCase() ?? r.role}` : "for everyone"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </SheetSection>
              )}

              <SheetSection title="Input parameters">
                <SchemaView schema={tool.input_schema} />
              </SheetSection>
              <SheetSection title="Output">
                <SchemaView schema={tool.output_schema} emptyText="No structured output declared." />
              </SheetSection>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
