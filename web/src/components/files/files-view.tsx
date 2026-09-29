"use client";

import { useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, FilterXIcon, FolderOpenIcon, Trash2Icon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  LiveDot,
  PageContainer,
  PageHeader,
  RelativeTime,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  toast,
  toastError,
  type Column,
} from "@/components/ui";
import { track } from "@/lib/analytics";
import { filesApi, type FileOut, type ListFilesQuery } from "@/lib/api";
import { useOrganization, usePermissions } from "@/lib/auth/hooks";
import { bytes } from "@/lib/format";
import { Dropzone } from "./dropzone";
import { FileDetailSheet } from "./file-detail-sheet";
import { FileTypeIcon } from "./file-icon";
import { FileStages } from "./file-stages";
import { PURPOSE_LABELS, fileStatusMeta, kindLabel, metaForFileStatus, stagesForFile } from "./file-status";
import { useDeleteFile, useDownloadFile, useFileList } from "./hooks";
import { UploadQueuePanel } from "./upload-queue-panel";
import { createUploadQueue, isActive, type UploadQueue } from "./upload-queue";
import { validateUpload } from "./validation";

type PurposeFilter = NonNullable<ListFilesQuery["purpose"]>;
type StatusFilter = NonNullable<ListFilesQuery["status"]>;
const PURPOSES: PurposeFilter[] = ["user_upload", "temp", "task_artifact", "browser_artifact"];
const STATUSES: StatusFilter[] = ["ready", "uploaded", "processing", "failed", "quarantined"];

/** Upload state is scoped to one organization: switching organizations starts a fresh workspace. */
export function FilesView() {
  const { tenantId } = useOrganization();
  return <FilesWorkspace key={tenantId ?? "none"} />;
}

function useUploadQueue(): { queue: UploadQueue; items: ReturnType<UploadQueue["getSnapshot"]> } {
  const qc = useQueryClient();
  // A list fetch still in flight may have been answered before this upload was stored. TanStack
  // folds an invalidation into an in-flight *first* fetch (there is no data to keep), which would
  // leave the list without the new file — so cancel in-flight list fetches, then refetch.
  const refreshLists = async () => {
    await qc.cancelQueries({ queryKey: ["files", "list"] });
    await qc.invalidateQueries({ queryKey: ["files", "list"] });
  };
  const [queue] = React.useState(() =>
    createUploadQueue({
      upload: (file, opts) => filesApi.upload(file, opts),
      concurrency: 2,
      validate: (file) => validateUpload(file),
      onUploaded: (file) => {
        track("file_uploaded", { content_type: file.content_type, size_bytes: file.size_bytes, purpose: file.purpose });
        void refreshLists();
      },
      onSettled: (item) => {
        if (item.cancelledAfterSend) void refreshLists();
      },
    }),
  );
  const items = React.useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  // Leaving the page cancels in-flight uploads (they are tied to this page's lifetime).
  React.useEffect(() => () => queue.cancelAll(), [queue]);
  const uploading = items.some((i) => i.phase === "queued" || isActive(i));
  React.useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);
  return { queue, items };
}

function FilesWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { can, isLoading: permsLoading } = usePermissions();
  const purpose = (PURPOSES as string[]).includes(params.get("purpose") ?? "")
    ? (params.get("purpose") as PurposeFilter)
    : null;
  const status = (STATUSES as string[]).includes(params.get("status") ?? "")
    ? (params.get("status") as StatusFilter)
    : null;
  const openFileId = params.get("file");

  const setParams = React.useCallback(
    (changes: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v) sp.set(k, v);
        else sp.delete(k);
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const { queue, items: uploads } = useUploadQueue();
  const waitingOnServer = uploads.some((u) => u.phase === "sending");
  const list = useFileList({ purpose, status }, waitingOnServer);
  const filtered = Boolean(purpose || status);
  const canWrite = can("files:write");

  const columns: Column<FileOut>[] = [
    {
      id: "name",
      header: "File",
      cell: (f) => (
        <div className="flex min-w-0 items-center gap-3">
          <FileTypeIcon type={f.content_type} />
          <div className="min-w-0">
            <p className="max-w-[16rem] truncate font-medium text-fg sm:max-w-xs lg:max-w-sm" title={f.filename}>
              {f.filename}
            </p>
            <p className="text-xs text-fg-subtle">
              {kindLabel(f.content_type)}
              <span className="sm:hidden"> · {bytes(f.size_bytes)}</span>
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (f) => {
        const meta = metaForFileStatus(f.status);
        return (
          <div className="flex flex-col items-start gap-1.5">
            <Tooltip content={meta.description}>
              <Badge tone={meta.tone} tabIndex={0}>
                <LiveDot tone={meta.tone} live={Boolean(meta.processing)} />
                {meta.label}
              </Badge>
            </Tooltip>
            <FileStages stages={stagesForFile(f)} className="hidden md:flex" />
          </div>
        );
      },
    },
    {
      id: "size",
      header: "Size",
      hideBelow: "sm",
      cell: (f) => <span className="text-fg-muted tabular-nums">{bytes(f.size_bytes)}</span>,
    },
    {
      id: "purpose",
      header: "Purpose",
      hideBelow: "lg",
      cell: (f) => (
        <span className="text-fg-muted">
          {PURPOSE_LABELS[f.purpose] ?? f.purpose}
          {f.expires_at && (
            <span className="block text-xs text-fg-subtle">
              deleted <RelativeTime value={f.expires_at} />
            </span>
          )}
        </span>
      ),
    },
    {
      id: "uploaded",
      header: "Uploaded",
      hideBelow: "md",
      cell: (f) => <RelativeTime value={f.created_at} className="text-fg-muted" />,
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "w-px text-right",
      cell: (f) => <FileRowActions file={f} canDelete={canWrite} />,
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Knowledge"
        title="Files"
        description="Documents your agents can read. Every upload is type-checked from its bytes and scanned, then its text is extracted and indexed for document search."
      />

      <div className="flex flex-col gap-4">
        <Dropzone
          onFiles={(files, p) => queue.add(files, p)}
          disabled={!permsLoading && !canWrite}
          disabledReason="Your role can't upload files (files:write)."
        />
        <UploadQueuePanel items={uploads} queue={queue} onOpenFile={(id) => setParams({ file: id })} />
      </div>

      <section aria-labelledby="files-title" className="mt-10 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="files-title" className="text-base font-semibold tracking-tight text-fg">
              Your files
            </h2>
            <p className="mt-0.5 text-[13px] text-fg-muted">
              Newest first. Select a file for details, extracted text and downloads.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Select value={purpose ?? "all"} onValueChange={(v) => setParams({ purpose: v === "all" ? null : v })}>
              <SelectTrigger aria-label="Filter by purpose" className="sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any purpose</SelectItem>
                {PURPOSES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PURPOSE_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status ?? "all"} onValueChange={(v) => setParams({ status: v === "all" ? null : v })}>
              <SelectTrigger aria-label="Filter by status" className="sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {fileStatusMeta[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DataTable
          caption="Your files"
          columns={columns}
          rows={list.items}
          rowKey={(f) => f.id}
          isLoading={list.isPending}
          error={list.error}
          onRetry={() => void list.refetch()}
          onRowClick={(f) => setParams({ file: f.id })}
          hasMore={list.hasNextPage}
          onLoadMore={() => void list.fetchNextPage()}
          isLoadingMore={list.isFetchingNextPage}
          empty={
            filtered ? (
              <EmptyState
                size="sm"
                icon={<FilterXIcon />}
                title="No files match these filters"
                action={
                  <Button size="sm" variant="secondary" onClick={() => setParams({ purpose: null, status: null })}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                size="sm"
                icon={<FolderOpenIcon />}
                title="No files yet"
                description="Upload PDFs, docs, spreadsheets or notes above. Your agents can read them, and you can search inside them from Search → Documents."
              />
            )
          }
        />
      </section>

      <FileDetailSheet fileId={openFileId} onClose={() => setParams({ file: null })} />
    </PageContainer>
  );
}

function FileRowActions({ file, canDelete }: { file: FileOut; canDelete: boolean }) {
  const download = useDownloadFile();
  const remove = useDeleteFile();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const downloadable = file.status !== "quarantined";
  return (
    <div
      className="flex items-center justify-end gap-0.5"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Tooltip content={downloadable ? "Download" : "Quarantined files can't be downloaded"}>
        <span>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Download ${file.filename}`}
            disabled={!downloadable}
            loading={download.isPending}
            onClick={() =>
              download.mutate(file.id, { onError: (err) => toastError(err, "Couldn't start the download") })
            }
          >
            {!download.isPending && <DownloadIcon />}
          </Button>
        </span>
      </Tooltip>
      {canDelete && (
        <>
          <Tooltip content="Delete">
            <Button
              size="icon-xs"
              variant="ghost"
              className="hover:bg-danger/10 hover:text-danger"
              aria-label={`Delete ${file.filename}`}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2Icon />
            </Button>
          </Tooltip>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            tone="danger"
            title={`Delete “${file.filename}”?`}
            description="The file and everything derived from it — extracted text, search passages and embeddings — are deleted. Agents can no longer read it. This can't be undone."
            confirmLabel="Delete file"
            confirmText="delete"
            loading={remove.isPending}
            onConfirm={() =>
              remove.mutate(file.id, {
                onSuccess: () => {
                  setConfirmOpen(false);
                  toast.success("File deleted", { description: file.filename });
                },
                onError: (err) => toastError(err, "Couldn't delete the file"),
              })
            }
          />
        </>
      )}
    </div>
  );
}
