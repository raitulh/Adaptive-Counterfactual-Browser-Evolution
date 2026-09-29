"use client";

import { ShieldAlertIcon } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InlineError } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import type { McpServerOut, McpToolOut } from "@/lib/api";
import { SchemaView } from "@/components/tools/schema-view";
import { reviewTool, shortHash } from "./mcp-review";
import { useUpdateMcpTool } from "./queries";
import { GovernanceFields, governanceOf, hintSummary, type GovernanceValues } from "./tool-governance";

export function DefinitionReview({ tool }: { tool: McpToolOut }) {
  const hints = hintSummary(tool.annotations ?? {});
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-1.5 text-xs text-fg-subtle">Description as advertised by the server (untrusted text — it is shown to the planning model)</p>
        <blockquote className="whitespace-pre-wrap break-words rounded-lg border border-line bg-bg px-3 py-2.5 text-[13px] leading-relaxed text-fg">
          {tool.title && <span className="mb-1 block font-medium">{tool.title}</span>}
          {tool.description || <span className="italic text-fg-subtle">No description</span>}
        </blockquote>
      </div>
      <div>
        <p className="mb-1.5 text-xs text-fg-subtle">Input parameters</p>
        <SchemaView schema={tool.input_schema} />
      </div>
      {tool.output_schema && (
        <div>
          <p className="mb-1.5 text-xs text-fg-subtle">Declared output</p>
          <SchemaView schema={tool.output_schema} emptyText="No structured output declared." />
        </div>
      )}
      <div>
        <p className="mb-1.5 text-xs text-fg-subtle">Server hints (advisory only — never trusted)</p>
        {hints.length === 0 ? (
          <p className="text-[13px] text-fg-muted">The server provided no behaviour hints.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {hints.map((h) => (
              <li key={h} className="rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 text-xs text-fg-muted">
                {h}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Explicit review before enabling a tool whose definition was never approved or changed since
 * approval. Enabling approves exactly the *current* definition hash.
 */
export function ToolReviewDialog({
  tool,
  server,
  onOpenChange,
}: {
  tool: McpToolOut | null;
  server: McpServerOut;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateMcpTool(server.id);
  const [confirmed, setConfirmed] = React.useState(false);
  const [gov, setGov] = React.useState<GovernanceValues | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const checkId = React.useId();

  const [shownFor, setShownFor] = React.useState<string | null>(null);
  if (tool && shownFor !== tool.id) {
    // Reset per tool (render-time state adjustment).
    setShownFor(tool.id);
    setConfirmed(false);
    setGov(governanceOf(tool));
    setError(null);
  }

  if (!tool) return null;
  const review = reviewTool(tool, server);
  const changed = review.state === "schema_changed";
  const values = gov ?? governanceOf(tool);

  const submit = async () => {
    setError(null);
    try {
      await update.mutateAsync({ toolId: tool.id, body: { enabled: true, ...values } });
      toast.success(changed ? `${tool.qualified_name} re-approved` : `${tool.qualified_name} enabled`, {
        description: `Approved definition ${shortHash(tool.schema_hash)}. Agents can call it now.`,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Dialog open={tool !== null} onOpenChange={(o) => !update.isPending && onOpenChange(o)}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {changed ? "Re-approve changed tool" : "Review tool"} <code className="font-mono text-[15px]">{tool.qualified_name}</code>
          </DialogTitle>
          <DialogDescription>
            Enabling approves this exact definition (hash <span className="font-mono">{shortHash(tool.schema_hash)}</span>). If the server changes the name,
            description, schemas or hints later, the tool is disabled again automatically.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          {changed && (
            <div role="alert" className="flex gap-3 rounded-xl border border-danger/35 bg-danger/[0.07] px-4 py-3 text-[13px]">
              <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <div className="text-fg-muted">
                <p className="font-medium text-fg">This tool changed after it was approved</p>
                <p className="mt-0.5">
                  AgentOS disabled it when a sync found a different definition. Only the approved hash is kept, so check the current description and parameters
                  carefully — a changed description can smuggle instructions to the model (tool poisoning).
                </p>
                <p className="mt-1.5 font-mono text-2xs text-fg-subtle">
                  approved {shortHash(tool.approved_schema_hash)} → current {shortHash(tool.schema_hash)}
                </p>
              </div>
            </div>
          )}
          <DefinitionReview tool={tool} />
          <div className="flex flex-col gap-3 rounded-xl border border-line p-4">
            <p className="text-[13px] font-medium text-fg">How AgentOS should treat it</p>
            <p className="-mt-2 text-xs text-fg-muted">These settings govern the tool — the server&apos;s own hints are ignored.</p>
            <GovernanceFields value={values} onChange={setGov} disabled={update.isPending} />
          </div>
          <label htmlFor={checkId} className="flex items-start gap-2.5 rounded-lg border border-line-strong bg-surface-1 px-3 py-2.5 text-[13px] text-fg">
            <Checkbox id={checkId} checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" />
            <span>
              I reviewed the current description and input schema of <span className="font-mono">{tool.qualified_name}</span> and approve this definition.
            </span>
          </label>
          {error !== null && <InlineError error={error} />}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            Cancel
          </Button>
          <Button variant={changed ? "danger" : "primary"} disabled={!confirmed} loading={update.isPending} onClick={() => void submit()}>
            {changed ? "Re-approve & enable" : "Approve & enable"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
