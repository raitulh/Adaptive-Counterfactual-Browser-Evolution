/**
 * In-app notifications.
 */
import { api, call } from "./client";
import type { paths } from "./generated/schema";

type Opts = { signal?: AbortSignal };

export type ListNotificationsQuery = NonNullable<paths["/api/v1/notifications"]["get"]["parameters"]["query"]>;

export const notificationsApi = {
  list: (query: ListNotificationsQuery = {}, o: Opts = {}) =>
    call(api.GET("/api/v1/notifications", { params: { query }, signal: o.signal })),
  markRead: (notificationId: string) =>
    call(
      api.POST("/api/v1/notifications/{notification_id}/read", {
        params: { path: { notification_id: notificationId } },
      }),
    ),
  markAllRead: () => call(api.POST("/api/v1/notifications/read-all")),
};
