"use client";

import { ArrowUpRightIcon, RotateCcwIcon, XIcon } from "lucide-react";
import * as React from "react";
import { Button, Progress, Tooltip } from "@/components/ui";
import { bytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FileTypeIcon } from "./file-icon";
import { FileStages } from "./file-stages";
import { metaForFileStatus, stagesForUpload, uploadLabel } from "./file-status";
import { useFileDetail } from "./hooks";
import { canCancel, canRetry, isActive, type UploadItem, type UploadQueue } from "./upload-queue";

export function UploadQueuePanel({
  items,
  queue,
  onOpenFile,
}: {
  items: UploadItem[];
  queue: UploadQueue;
  onOpenFile: (id: string) => void;
}) {
  if (items.length === 0) return null;
  const active = items.filter((i) => i.phase === "queued" || isActive(i)).length;
  const finished = items.filter((i) => i.phase === "done" || i.phase === "cancelled" || i.phase === "rejected").length;
  return (
    <section aria-labelledby="uploads-title" className="rounded-2xl border border-line bg-surface-1">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div>
          <h2 id="uploads-title" className="text-sm font-semibold tracking-tight text-fg">
            Uploads
          </h2>
          <p className="text-xs text-fg-subtle" aria-live="polite">
            {active > 0 ? `${active} in progress` : "All uploads settled"} · {items.length} total
          </p>
        </div>
        <div className="flex items-center gap-1">
          {active > 0 && (
            <Button size="xs" variant="ghost" onClick={() => queue.cancelAll()}>
              Cancel all
            </Button>
          )}
          {finished > 0 && (
            <Button size="xs" variant="ghost" onClick={() => queue.clearFinished()}>
              Clear finished
            </Button>
          )}
        </div>
      </header>
      <ul className="divide-y divide-line">
        {items.map((item) => (
          <li key={item.id}>
            {item.phase === "done" && item.result ? (
              <UploadedRow item={item} queue={queue} onOpenFile={onOpenFile} />
            ) : (
              <UploadRow item={item} queue={queue} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** After the server answered, the file's own status (polled while it's processing) is the truth. */
function UploadedRow({ item, queue, onOpenFile }: { item: UploadItem; queue: UploadQueue; onOpenFile: (id: string) => void }) {
  const detail = useFileDetail(item.result!.id);
  const server = detail.data ?? item.result!;
  return <UploadRow item={item} queue={queue} server={server} onOpen={() => onOpenFile(server.id)} />;
}

function UploadRow({
  item,
  queue,
  server,
  onOpen,
}: {
  item: UploadItem;
  queue: UploadQueue;
  server?: { status: string; id: string } | null;
  onOpen?: () => void;
}) {
  const stages = stagesForUpload(item, server);
  const label = uploadLabel(item, server);
  const statusMeta = server ? metaForFileStatus(server.status) : null;
  const failed = item.phase === "failed" || item.phase === "rejected" || Boolean(statusMeta?.failed);
  // Announce phase changes, not every percent.
  const announce = item.phase === "uploading" ? "Uploading" : label;

  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5 sm:px-5">
      <div className="flex items-center gap-3">
        <FileTypeIcon type={item.result?.content_type ?? item.file.type ?? item.name} className="size-8" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="min-w-0 truncate text-[13px] font-medium text-fg" title={item.name}>
              {item.name}
            </p>
            <span className="shrink-0 text-xs tabular-nums text-fg-subtle">{bytes(item.size)}</span>
            {item.purpose === "temp" && <span className="shrink-0 text-2xs uppercase tracking-wider text-fg-subtle">Temporary</span>}
          </div>
          <p className={cn("mt-0.5 text-xs", failed ? "text-danger" : statusMeta?.stage === "ready" ? "text-success" : "text-fg-muted")}>
            <span aria-hidden>{label}</span>
            <span className="sr-only" aria-live="polite">
              {item.name}: {announce}
            </span>
            {item.attempts > 1 && item.phase !== "done" && <span className="text-fg-subtle"> · attempt {item.attempts}</span>}
          </p>
        </div>
        <FileStages stages={stages} className="hidden sm:flex" />
        <div className="flex shrink-0 items-center gap-0.5">
          {onOpen && (
            <Tooltip content="Open details">
              <Button size="icon-xs" variant="ghost" aria-label={`Open ${item.name}`} onClick={onOpen}>
                <ArrowUpRightIcon />
              </Button>
            </Tooltip>
          )}
          {canRetry(item) && (
            <Tooltip content="Retry (safe: the same upload is never stored twice)">
              <Button size="icon-xs" variant="ghost" aria-label={`Retry ${item.name}`} onClick={() => queue.retry(item.id)}>
                <RotateCcwIcon />
              </Button>
            </Tooltip>
          )}
          {canCancel(item) ? (
            <Tooltip content="Cancel upload">
              <Button size="icon-xs" variant="ghost" aria-label={`Cancel ${item.name}`} onClick={() => queue.cancel(item.id)}>
                <XIcon />
              </Button>
            </Tooltip>
          ) : (
            <Tooltip content="Dismiss">
              <Button size="icon-xs" variant="ghost" aria-label={`Dismiss ${item.name}`} onClick={() => queue.dismiss(item.id)}>
                <XIcon />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
      {(item.phase === "uploading" || item.phase === "sending") && (
        <Progress
          value={item.phase === "sending" ? null : item.progress * 100}
          label={item.phase === "sending" ? `${item.name}: scanning and storing` : `${item.name}: upload progress`}
          className="h-1"
        />
      )}
      {item.error && <p className="text-xs leading-relaxed text-danger/90">{item.error.message}</p>}
      {item.phase === "cancelled" && item.cancelledAfterSend && (
        <p className="text-xs leading-relaxed text-fg-subtle">
          Cancelled after the file was sent. If the server had already stored it, it appears in your files below.
        </p>
      )}
    </div>
  );
}
