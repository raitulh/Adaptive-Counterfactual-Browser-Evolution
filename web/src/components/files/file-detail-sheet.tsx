"use client";

import { ArrowUpRightIcon, DownloadIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import {
  Badge,
  Button,
  ConfirmDialog,
  CopyButton,
  ErrorState,
  IdChip,
  KeyValue,
  LiveDot,
  RelativeTime,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Skeleton,
  Tooltip,
  toast,
  toastError,
} from "@/components/ui";
import type { FileOut } from "@/lib/api";
import { usePermissions } from "@/lib/auth/hooks";
import { bytes, dateTime, number } from "@/lib/format";
import { useUiStore } from "@/stores/ui";
import { FileTypeIcon } from "./file-icon";
import { FileStages } from "./file-stages";
import { PURPOSE_LABELS, kindLabel, metaForExtraction, metaForFileStatus, scanStatusMeta, stagesForFile } from "./file-status";
import { useDeleteFile, useDownloadFile, useFileDetail } from "./hooks";

function languageName(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function FileDetailSheet({ fileId, onClose }: { fileId: string | null; onClose: () => void }) {
  return (
    <Sheet open={Boolean(fileId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="max-w-full sm:max-w-lg"
        aria-describedby={undefined}
        // Focus the panel itself, not the first button (which would pop its tooltip).
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        {fileId && <FileDetail fileId={fileId} onDeleted={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function FileDetail({ fileId, onDeleted }: { fileId: string; onDeleted: () => void }) {
  const detail = useFileDetail(fileId);
  if (detail.isPending) {
    return (
      <div className="flex flex-col gap-4 p-6" aria-busy="true">
        <SheetTitle className="sr-only">Loading file</SheetTitle>
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-xl" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }
  if (detail.isError) {
    return (
      <div className="p-6">
        <SheetTitle className="sr-only">File unavailable</SheetTitle>
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      </div>
    );
  }
  return <FileDetailBody file={detail.data} onDeleted={onDeleted} />;
}

function FileDetailBody({ file, onDeleted }: { file: FileOut; onDeleted: () => void }) {
  const { can } = usePermissions();
  const developerMode = useUiStore((s) => s.developerMode);
  const download = useDownloadFile();
  const remove = useDeleteFile();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const status = metaForFileStatus(file.status);
  const scan = scanStatusMeta[file.scan_status] ?? { label: file.scan_status, tone: "neutral" as const, description: "" };
  const meta = file.metadata ?? null;
  const extraction = metaForExtraction(meta?.extraction_status);
  const downloadable = file.status !== "quarantined" && file.status !== "deleted";

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-col gap-5 border-b border-line p-5 sm:p-6">
          <div className="flex items-start gap-3 pr-8">
            <FileTypeIcon type={file.content_type} className="size-11 rounded-xl" />
            <div className="min-w-0">
              <SheetTitle className="break-all text-base font-semibold leading-snug tracking-tight text-fg">{file.filename}</SheetTitle>
              <SheetDescription className="mt-0.5 text-[13px] text-fg-muted">
                {kindLabel(file.content_type)} · {bytes(file.size_bytes)} · uploaded <RelativeTime value={file.created_at} />
              </SheetDescription>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2/50 p-4">
            <Badge tone={status.tone} size="md" className="self-start">
              <LiveDot tone={status.tone} live={Boolean(status.processing)} />
              {status.label}
            </Badge>
            <FileStages stages={stagesForFile(file)} size="md" />
            <p className="text-[13px] leading-relaxed text-fg-muted" aria-live="polite">
              {status.description}
              {status.processing && " This updates automatically."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Tooltip content={downloadable ? "Downloads through a signed link that expires in a few minutes." : "Quarantined files can't be downloaded."}>
              <span>
                <Button
                  variant="secondary"
                  disabled={!downloadable}
                  loading={download.isPending}
                  onClick={() => download.mutate(file.id, { onError: (err) => toastError(err, "Couldn't start the download") })}
                >
                  <DownloadIcon aria-hidden /> Download
                </Button>
              </span>
            </Tooltip>
            {can("files:write") && (
              <Button variant="danger-outline" onClick={() => setConfirmOpen(true)}>
                <Trash2Icon aria-hidden /> Delete
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6 p-5 sm:p-6">
          <section className="flex flex-col gap-3">
            <h3 className="text-2xs font-medium uppercase tracking-wider text-fg-subtle">Extracted content</h3>
            {meta ? (
              <>
                <KeyValue
                  items={[
                    [
                      "Extraction",
                      extraction ? (
                        <Tooltip content={extraction.description}>
                          <span tabIndex={0} className="outline-none">
                            <Badge tone={extraction.tone}>{extraction.label}</Badge>
                          </span>
                        </Tooltip>
                      ) : (
                        meta.extraction_status
                      ),
                    ],
                    ...(meta.page_count !== null && meta.page_count !== undefined ? ([["Pages", number(meta.page_count)]] as [string, React.ReactNode][]) : []),
                    ["Characters", meta.char_count !== null && meta.char_count !== undefined ? number(meta.char_count) : "—"],
                    [
                      "Indexed passages",
                      meta.chunk_count !== null && meta.chunk_count !== undefined ? (
                        meta.chunk_count > 0 ? (
                          <span>
                            {number(meta.chunk_count)}{" "}
                            <span className="text-fg-subtle">· searchable in</span>{" "}
                            <Link href="/app/search?tab=documents" className="text-fg-muted underline-offset-4 hover:text-fg hover:underline">
                              Documents
                            </Link>
                          </span>
                        ) : (
                          "0 · not searchable"
                        )
                      ) : (
                        "—"
                      ),
                    ],
                    ["Language", languageName(meta.language) ?? <span className="text-fg-subtle">Not detected</span>],
                  ]}
                />
                {meta.extracted_summary && (
                  <figure className="flex flex-col gap-1.5">
                    <figcaption className="text-xs text-fg-subtle">Beginning of the extracted text</figcaption>
                    <blockquote className="max-h-48 overflow-y-auto whitespace-pre-line rounded-lg border border-line bg-bg px-3 py-2.5 text-[13px] leading-relaxed text-fg-muted">
                      {meta.extracted_summary}
                    </blockquote>
                  </figure>
                )}
              </>
            ) : (
              <p className="text-[13px] text-fg-muted">
                {status.processing ? "Extraction hasn't finished yet." : "No extracted content is available for this file."}
              </p>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-2xs font-medium uppercase tracking-wider text-fg-subtle">File</h3>
            <KeyValue
              items={[
                ["Type", <span key="t" className="font-mono text-xs">{file.content_type}</span>],
                ["Size", `${bytes(file.size_bytes)} (${number(file.size_bytes)} bytes)`],
                ["Purpose", PURPOSE_LABELS[file.purpose] ?? file.purpose],
                [
                  "Malware scan",
                  <Tooltip key="s" content={scan.description}>
                    <span tabIndex={0} className="outline-none">
                      <Badge tone={scan.tone} variant="outline">
                        {scan.label}
                      </Badge>
                    </span>
                  </Tooltip>,
                ],
                ["Uploaded", dateTime(file.created_at)],
                ["Updated", dateTime(file.updated_at)],
                ...(file.expires_at ? ([["Deleted automatically", dateTime(file.expires_at)]] as [string, React.ReactNode][]) : []),
                ...(file.task_id
                  ? ([
                      [
                        "Task",
                        <Link key="task" href={`/app/tasks/${file.task_id}`} className="inline-flex items-center gap-1 text-fg-muted hover:text-fg">
                          Open task <ArrowUpRightIcon className="size-3.5" aria-hidden />
                        </Link>,
                      ],
                    ] as [string, React.ReactNode][])
                  : []),
                [
                  "SHA-256",
                  <span key="sha" className="inline-flex max-w-full items-center gap-1">
                    <span className="truncate font-mono text-xs text-fg-muted" title={file.sha256}>
                      {file.sha256.slice(0, 16)}…
                    </span>
                    <CopyButton value={file.sha256} label="Copy SHA-256" />
                  </span>,
                ],
                ...(developerMode ? ([["ID", <IdChip key="id" id={file.id} label="file" />]] as [string, React.ReactNode][]) : []),
              ]}
            />
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="danger"
        title={`Delete “${file.filename}”?`}
        description="The file and everything derived from it — extracted text, search passages and embeddings — are deleted. Agents can no longer read it and it disappears from document search. This can't be undone."
        confirmLabel="Delete file"
        confirmText="delete"
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(file.id, {
            onSuccess: () => {
              setConfirmOpen(false);
              toast.success("File deleted", { description: file.filename });
              onDeleted();
            },
            onError: (err) => toastError(err, "Couldn't delete the file"),
          })
        }
      />
    </>
  );
}
