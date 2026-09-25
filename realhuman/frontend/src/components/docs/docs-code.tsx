import { CodeBlock } from "@/components/ui/code-block";
import { CopyButton } from "@/components/ui/copy-button";
import type { CodeSample } from "@/lib/constants/code-samples";
import { cn } from "@/lib/utils/cn";

/** Code sample with a filename header and copy action. */
export function DocsCode({ sample, className }: { sample: CodeSample; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-surface", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border py-1.5 pr-2 pl-4">
        <span className="truncate font-mono text-[11px] text-subtle">{sample.filename}</span>
        <CopyButton value={sample.code} label={`Copy ${sample.label} example`} />
      </div>
      <CodeBlock code={sample.code} language={sample.language} label={`${sample.label} example`} />
    </div>
  );
}
