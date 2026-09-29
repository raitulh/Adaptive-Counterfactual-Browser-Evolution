/**
 * Server-only access to public AgentOS API endpoints (no credentials) for server-rendered marketing
 * pages. Importing this module from a Client Component fails the build.
 */
import "server-only";

export {
  getPublicPlans,
  publicApiBase,
  publicApiDocsUrl,
  publicApiOrigin,
  type PublicFetchFailure,
  type PublicFetchOptions,
  type PublicFetchResult,
} from "./public-fetch";
