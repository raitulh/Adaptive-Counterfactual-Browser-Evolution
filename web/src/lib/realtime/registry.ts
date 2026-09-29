/**
 * Which tasks currently have a dedicated task stream open (the user stream skips detail
 * invalidation for those — their own stream already reconciles them).
 */
const active = new Map<string, number>();

export function markTaskStreamActive(taskId: string): () => void {
  active.set(taskId, (active.get(taskId) ?? 0) + 1);
  return () => {
    const n = (active.get(taskId) ?? 1) - 1;
    if (n <= 0) active.delete(taskId);
    else active.set(taskId, n);
  };
}

export function isTaskStreamActive(taskId: string): boolean {
  return active.has(taskId);
}
