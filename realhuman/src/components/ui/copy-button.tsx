"use client";

import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { cn } from "@/lib/utils/cn";

interface CopyButtonProps {
  value: string;
  /** Accessible label, e.g. "Copy Node.js example". */
  label?: string;
  className?: string;
  showText?: boolean;
}

export function CopyButton({ value, label = "Copy", className, showText = true }: CopyButtonProps) {
  const { copied, copy } = useCopyToClipboard();

  async function handleCopy() {
    const ok = await copy(value);
    if (!ok) toast.error("Couldn't access the clipboard. Select the text and copy it manually.");
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCopy}
        aria-label={copied ? "Copied" : label}
        className={cn("h-7 gap-1.5 px-2 text-xs", copied && "text-foreground", className)}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {showText ? <span aria-hidden>{copied ? "Copied" : "Copy"}</span> : null}
      </Button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </>
  );
}
