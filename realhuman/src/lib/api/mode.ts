import type { ApiMode } from "@/lib/api/types";
import { env } from "@/lib/env";

/** Lightweight access to the adapter mode without importing any adapter code. */
export const apiMode: ApiMode = env.NEXT_PUBLIC_VERIFICATION_MODE;
