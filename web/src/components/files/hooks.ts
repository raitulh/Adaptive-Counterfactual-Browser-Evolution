"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { filesApi, type FileOut, type ListFilesQuery } from "@/lib/api";
import { qk } from "@/lib/query/keys";
import { useCursorQuery } from "@/lib/query/pagination";
import { isFileProcessing } from "./file-status";

/** Poll only while something is still being scanned/extracted on the server. */
export const PROCESSING_POLL_MS = 2_000;

export function useFileList(filter: Pick<ListFilesQuery, "purpose" | "status">, extraPoll = false) {
  const query: ListFilesQuery = {};
  if (filter.purpose) query.purpose = filter.purpose;
  if (filter.status) query.status = filter.status;
  return useCursorQuery<FileOut>({
    queryKey: qk.files.list(query),
    fetchPage: (cursor, signal) => filesApi.list({ ...query, cursor, limit: 30 }, { signal }),
    refetchInterval: (items) => (extraPoll || items.some(isFileProcessing) ? PROCESSING_POLL_MS : false),
  });
}

export function useFileDetail(fileId: string | null) {
  return useQuery({
    queryKey: qk.files.detail(fileId ?? ""),
    queryFn: ({ signal }) => filesApi.get(fileId!, { signal }),
    enabled: Boolean(fileId),
    refetchInterval: (q) => (q.state.data && isFileProcessing(q.state.data) ? PROCESSING_POLL_MS : false),
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => filesApi.remove(id),
    onSuccess: () => {
      // Lists only: the (now 404) detail query is dropped when its sheet unmounts.
      void qc.invalidateQueries({ queryKey: ["files", "list"] });
      // Its extracted passages are gone from document search too.
      void qc.invalidateQueries({ queryKey: ["search", "documents"] });
    },
  });
}

/**
 * Fetch a short-lived signed URL and start the download right away (the link expires in minutes,
 * so it is never cached or rendered ahead of time).
 */
export function useDownloadFile() {
  return useMutation({
    mutationFn: async (id: string) => {
      const link = await filesApi.downloadUrl(id);
      const a = document.createElement("a");
      a.href = link.url;
      a.download = link.filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return link;
    },
  });
}
