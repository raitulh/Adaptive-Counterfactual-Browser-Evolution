/**
 * Public API types. Everything here is derived from the generated OpenAPI contract — no hand-written
 * copies of backend models. Import types from "@/lib/api" rather than from the generated file.
 */
import type { components } from "../generated/schema";

export type * from "../generated/schema";
export {
  actorTypeValues,
  approvalStatusValues,
  automationRunStatusValues,
  connectionStatusValues,
  errorClassValues,
  eventTypeValues,
  extractionStatusValues,
  fileStatusValues,
  googleCapabilityValues,
  mCPServerStatusValues as mcpServerStatusValues,
  mCPToolStatusValues as mcpToolStatusValues,
  memoryStatusValues,
  memoryTypeValues,
  notificationEventValues,
  permissionCodeValues,
  permissionLevelValues,
  recoveryActionValues,
  riskLevelValues,
  stepStatusValues,
  systemRoleValues,
  taskStatusValues,
  trustLevelValues,
  verificationStatusValues,
} from "../generated/schema";

type Schemas = components["schemas"];

/** Cursor page as returned by every keyset-paginated list endpoint. */
export interface Page<T> {
  items: T[];
  next_cursor?: string | null;
  has_more?: boolean;
}

// Friendlier names for schemas whose generated names are awkward.
export type AcbeExperimentOut = Schemas["app__acbe__router__ExperimentOut"];
export type EvaluationExperimentOut = Schemas["app__evaluation__schemas__ExperimentOut"];

/** Task event as delivered by REST (`TaskEventOut`) and SSE (same fields + task_id). */
export type TaskEvent = Schemas["TaskEventOut"] & { task_id?: string };

/** Messages on the user-wide stream (`GET /events/stream`). */
export type UserStreamMessage =
  | {
      type: Exclude<Schemas["EventType"], "NOTIFICATION_CREATED">;
      task_id: string;
      seq: number;
      event_type: Exclude<Schemas["EventType"], "NOTIFICATION_CREATED">;
      status: Schemas["TaskStatus"];
      step_id: string | null;
    }
  | {
      type: "NOTIFICATION_CREATED";
      notification_id: string;
      event: Schemas["NotificationEvent"];
      title: string;
    };
