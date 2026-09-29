import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Shorten an id for display (full id stays available via copy/title). */
export function shortId(id: string | null | undefined, length = 8): string {
  if (!id) return "—";
  return id.replace(/-/g, "").slice(-length);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
