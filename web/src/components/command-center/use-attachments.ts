"use client";

/**
 * Composer attachments: each file is uploaded immediately (`filesApi.upload`, multipart with
 * progress). A retry of the same file reuses its idempotency key; removing an uploading file aborts it.
 */
import * as React from "react";
import { filesApi, newIdempotencyKey, type FileOut } from "@/lib/api";
import { normalizeError } from "@/lib/api/errors";
import { track } from "@/lib/analytics";
import { outcomeUnknown } from "./submission-key";

export const MAX_ATTACHMENTS = 5;

export interface Attachment {
  localId: string;
  file: File;
  status: "uploading" | "ready" | "error";
  progress: number;
  result?: FileOut;
  error?: string;
  key: string;
}

export function useAttachments() {
  const [items, setItems] = React.useState<Attachment[]>([]);
  const controllers = React.useRef(new Map<string, AbortController>());

  const patch = React.useCallback((localId: string, p: Partial<Attachment>) => {
    setItems((prev) => prev.map((a) => (a.localId === localId ? { ...a, ...p } : a)));
  }, []);

  const start = React.useCallback(
    (a: Attachment) => {
      const controller = new AbortController();
      controllers.current.set(a.localId, controller);
      patch(a.localId, { status: "uploading", progress: 0, error: undefined });
      filesApi
        .upload(a.file, {
          purpose: "user_upload",
          signal: controller.signal,
          idempotencyKey: a.key,
          onProgress: (f) => patch(a.localId, { progress: f }),
        })
        .then((result) => {
          if (result.status === "quarantined" || result.status === "failed") {
            patch(a.localId, {
              status: "error",
              result,
              error: result.status === "quarantined" ? "Blocked by the security scan" : "Processing failed",
            });
            return;
          }
          patch(a.localId, { status: "ready", progress: 1, result });
          track("file_uploaded", { size_bytes: result.size_bytes, source: "composer" });
        })
        .catch((err) => {
          const e = normalizeError(err);
          if (e.kind === "aborted") return;
          // Unknown outcome → keep the key so a retry can't create a duplicate; otherwise start fresh.
          patch(a.localId, {
            status: "error",
            error: e.userMessage,
            key: outcomeUnknown(err) ? a.key : newIdempotencyKey(),
          });
        })
        .finally(() => controllers.current.delete(a.localId));
    },
    [patch],
  );

  const itemsRef = React.useRef(items);
  React.useLayoutEffect(() => {
    itemsRef.current = items;
  }, [items]);

  /** Adds up to the remaining capacity and starts uploading; returns how many files were accepted. */
  const add = React.useCallback(
    (files: Iterable<File>) => {
      const room = Math.max(0, MAX_ATTACHMENTS - itemsRef.current.length);
      const accepted = [...files].slice(0, room).map<Attachment>((file) => ({
        localId: newIdempotencyKey(),
        file,
        status: "uploading",
        progress: 0,
        key: newIdempotencyKey(),
      }));
      itemsRef.current = [...itemsRef.current, ...accepted];
      setItems((prev) => [...prev, ...accepted]);
      accepted.forEach(start);
      return accepted.length;
    },
    [start],
  );

  const retry = React.useCallback(
    (localId: string) => {
      const a = items.find((x) => x.localId === localId);
      if (a) start(a);
    },
    [items, start],
  );

  const remove = React.useCallback((localId: string) => {
    controllers.current.get(localId)?.abort();
    controllers.current.delete(localId);
    setItems((prev) => prev.filter((a) => a.localId !== localId));
  }, []);

  const clear = React.useCallback(() => {
    for (const c of controllers.current.values()) c.abort();
    controllers.current.clear();
    setItems([]);
  }, []);

  React.useEffect(() => {
    const map = controllers.current;
    return () => {
      for (const c of map.values()) c.abort();
    };
  }, []);

  const uploading = items.some((a) => a.status === "uploading");
  const ready = items
    .filter((a) => a.status === "ready" && a.result)
    .map((a) => ({ id: a.result!.id, filename: a.result!.filename }));
  return { items, add, retry, remove, clear, uploading, ready, full: items.length >= MAX_ATTACHMENTS };
}
