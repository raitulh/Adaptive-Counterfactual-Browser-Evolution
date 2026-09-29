/** Helpers shared by route handlers: resource lookup, Idempotency-Key replay, permissions. */
import { type Ctx, DemoHttpError, json, notFound, unprocessable } from "../http";
import type { Srv } from "../router";
import type { DemoStore, TaskRec } from "../store";

export function requireTask(srv: Srv, taskId: string): TaskRec {
  const { store } = srv;
  const task = store.tasks.get(taskId);
  if (!task || (task.userId !== store.me.id && !can(store, "tasks:read_all"))) throw notFound("Task not found");
  return task;
}

export function can(store: DemoStore, permission: string): boolean {
  return store.me.permissions.includes(permission);
}

export function requirePermission(store: DemoStore, permission: string): void {
  if (!can(store, permission)) {
    throw new DemoHttpError(403, "forbidden", "You don't have permission to perform this action.", {
      missing_permissions: [permission],
    });
  }
}

/**
 * `run_idempotent`: the first response for (user, key, route) is stored and replayed for the same
 * request (header `Idempotent-Replayed: true`); reusing the key for a different request is a 422.
 */
export async function idempotent(
  ctx: Ctx,
  srv: Srv,
  payload: unknown,
  handler: () => { status: number; body: unknown },
): Promise<Response> {
  const key = ctx.header("idempotency-key");
  if (!key) {
    const { status, body } = handler();
    return json(ctx, status, body);
  }
  if (key.length > 200)
    throw unprocessable("Idempotency-Key is too long", "validation_failed", { field: "Idempotency-Key" });
  const slot = `${srv.store.me.id}:${key}:${ctx.method} ${ctx.path}`;
  const fingerprint = JSON.stringify(payload ?? null);
  const existing = srv.store.idempotency.get(slot);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      throw unprocessable("Idempotency-Key was already used with a different request", "idempotency_key_reused");
    }
    return json(ctx, existing.status, existing.body, { "idempotent-replayed": "true" });
  }
  const { status, body } = handler();
  srv.store.idempotency.set(slot, { fingerprint, status, body: JSON.parse(JSON.stringify(body)) as unknown });
  return json(ctx, status, body);
}
