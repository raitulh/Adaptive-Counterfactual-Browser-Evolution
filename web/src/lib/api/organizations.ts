/**
 * Active organization, policy and members. The backend is authoritative for RBAC.
 */
import { api, call } from "./client";
import type {
  MemberAdd,
  MemberRoleUpdate,
  OrganizationCreate,
  OrganizationPolicy,
  OrganizationUpdate,
} from "./schemas";

type Opts = { signal?: AbortSignal };

export const organizationsApi = {
  create: (body: OrganizationCreate) => call(api.POST("/api/v1/organizations", { body })),
  current: (o: Opts = {}) => call(api.GET("/api/v1/organizations/current", { signal: o.signal })),
  updateCurrent: (body: OrganizationUpdate) => call(api.PATCH("/api/v1/organizations/current", { body })),
  policy: (o: Opts = {}) => call(api.GET("/api/v1/organizations/current/policy", { signal: o.signal })),
  updatePolicy: (body: OrganizationPolicy) => call(api.PUT("/api/v1/organizations/current/policy", { body })),
  members: (o: Opts = {}) => call(api.GET("/api/v1/organizations/current/members", { signal: o.signal })),
  addMember: (body: MemberAdd) => call(api.POST("/api/v1/organizations/current/members", { body })),
  updateMemberRole: (memberId: string, body: MemberRoleUpdate) =>
    call(
      api.PATCH("/api/v1/organizations/current/members/{member_id}", {
        params: { path: { member_id: memberId } },
        body,
      }),
    ),
  removeMember: (memberId: string) =>
    call(
      api.DELETE("/api/v1/organizations/current/members/{member_id}", { params: { path: { member_id: memberId } } }),
    ),
};
