"use client";

import { useInView } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { CodeBlock } from "@/components/ui/code-block";
import { CopyButton } from "@/components/ui/copy-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";
import {
  responseSample,
  restSample,
  serverSample,
  type CodeSample,
} from "@/lib/constants/code-samples";

const SAMPLES: readonly CodeSample[] = [serverSample, restSample];
const STEP_MS = 2200;

/** Walks the highlight through the lines that matter, while visible. */
function useActiveLine(lines: readonly number[] | undefined, running: boolean) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!running || !lines || lines.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % lines.length), STEP_MS);
    return () => clearInterval(timer);
  }, [lines, running]);
  if (!lines || lines.length === 0) return null;
  return lines[running ? index % lines.length : lines.length > 2 ? 2 : 0] ?? null;
}

export function CodeShowcase() {
  const [tab, setTab] = useState(serverSample.id);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-10% 0px" });
  const reducedMotion = usePrefersReducedMotion();
  const current = SAMPLES.find((sample) => sample.id === tab) ?? serverSample;
  const activeLine = useActiveLine(current.focusLines, inView && !reducedMotion);

  return (
    <div ref={ref} className="flex flex-col gap-3">
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-elevated"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
          <TabsList aria-label="Integration examples">
            {SAMPLES.map((sample) => (
              <TabsTrigger key={sample.id} value={sample.id}>
                {sample.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex items-center gap-2">
            <span className="hidden font-mono text-[11px] text-subtle sm:inline">
              {current.filename}
            </span>
            <CopyButton value={current.code} label={`Copy ${current.label} example`} />
          </div>
        </div>
        {SAMPLES.map((sample) => (
          <TabsContent key={sample.id} value={sample.id}>
            <CodeBlock
              code={sample.code}
              language={sample.language}
              label={`${sample.label} integration example`}
              activeLine={sample.id === current.id ? activeLine : null}
            />
          </TabsContent>
        ))}
      </Tabs>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface/70">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <span className="text-[13px] font-medium">Example response</span>
          <span className="font-mono text-[11px] text-subtle">{responseSample.filename}</span>
        </div>
        <CodeBlock
          code={responseSample.code}
          language="json"
          label="Example verification response"
          showLineNumbers={false}
          className="max-h-80"
        />
      </div>
    </div>
  );
}
