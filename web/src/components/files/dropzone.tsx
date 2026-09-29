"use client";

import { UploadCloudIcon } from "lucide-react";
import * as React from "react";
import { Button, Switch, Tooltip } from "@/components/ui";
import type { UploadPurpose } from "@/lib/api";
import { bytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ACCEPT_ATTRIBUTE, ACCEPTED_KINDS, MAX_UPLOAD_BYTES } from "./validation";

/** Drag & drop zone with a keyboard-accessible "browse" button. */
export function Dropzone({
  onFiles,
  disabled,
  disabledReason,
  className,
}: {
  onFiles: (files: File[], purpose: UploadPurpose) => void;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [temporary, setTemporary] = React.useState(false);
  const depth = React.useRef(0);
  const purpose: UploadPurpose = temporary ? "temp" : "user_upload";
  const switchId = React.useId();

  const accept = (list: FileList | null) => {
    if (!list || list.length === 0 || disabled) return;
    onFiles(Array.from(list), purpose);
  };

  return (
    <div
      onDragEnter={(e) => {
        if (disabled || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (disabled || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        accept(e.dataTransfer.files);
      }}
      className={cn(
        "relative flex flex-col items-center gap-4 overflow-hidden rounded-2xl border border-dashed px-6 py-9 text-center transition-[border-color,background-color] duration-200",
        dragging ? "border-accent bg-accent/[0.06]" : "border-line-strong bg-surface-1/60",
        disabled && "opacity-60",
        className,
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 -top-24 mx-auto h-40 w-2/3 rounded-full bg-accent/10 blur-3xl transition-opacity duration-300",
          dragging ? "opacity-100" : "opacity-40",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "relative flex size-12 items-center justify-center rounded-2xl border bg-surface-2 transition-transform duration-200",
          dragging ? "scale-110 border-accent/50 text-accent" : "border-line-strong text-fg-muted",
        )}
      >
        <UploadCloudIcon className="size-5" />
      </span>
      <div className="relative">
        <p className="text-[15px] font-medium text-fg">{dragging ? "Drop to upload" : "Drag files here to give your agents something to read"}</p>
        <p className="mt-1 text-[13px] text-fg-muted">
          {ACCEPTED_KINDS.map((k) => k.label).join(", ")} · up to {bytes(MAX_UPLOAD_BYTES)} each · scanned, then indexed for search
        </p>
      </div>
      <div className="relative flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
        <Tooltip content={disabled ? disabledReason : undefined}>
          <span>
            <Button type="button" variant="primary" onClick={() => inputRef.current?.click()} disabled={disabled}>
              Browse files
            </Button>
          </span>
        </Tooltip>
        <span className="flex items-center gap-2">
          <Switch id={switchId} checked={temporary} onCheckedChange={setTemporary} disabled={disabled} />
          <label htmlFor={switchId} className="text-left text-[13px] text-fg-muted">
            Temporary <span className="text-fg-subtle">(deleted automatically after the retention window)</span>
          </label>
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          accept(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
