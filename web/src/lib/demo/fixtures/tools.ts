/**
 * Built-in tool catalogue, mirroring the backend specs (`backend/app/tools/builtin/*`, search, files,
 * memory). Names, permission/risk levels, scopes, verification methods and retry limits are real.
 */
import type { PermissionLevel, RiskLevel } from "@/lib/api";

export const SCOPES = {
  calendarRead: "https://www.googleapis.com/auth/calendar.readonly",
  calendarWrite: "https://www.googleapis.com/auth/calendar.events",
  gmailRead: "https://www.googleapis.com/auth/gmail.readonly",
  gmailCompose: "https://www.googleapis.com/auth/gmail.compose",
  gmailSend: "https://www.googleapis.com/auth/gmail.send",
  driveRead: "https://www.googleapis.com/auth/drive.readonly",
  driveFile: "https://www.googleapis.com/auth/drive.file",
  contactsRead: "https://www.googleapis.com/auth/contacts.readonly",
} as const;

/** Capability bundles → scopes (`CAPABILITY_SCOPES` in backend/app/integrations/google/oauth.py). */
export const CAPABILITY_SCOPES: Record<string, string[]> = {
  "gmail.read": [SCOPES.gmailRead],
  "gmail.compose": [SCOPES.gmailCompose],
  "gmail.send": [SCOPES.gmailSend],
  "calendar.read": [SCOPES.calendarRead],
  "calendar.write": [SCOPES.calendarWrite],
  "drive.read": [SCOPES.driveRead],
  "drive.file": [SCOPES.driveFile],
  "contacts.read": [SCOPES.contactsRead],
};

/** A granted scope that also satisfies narrower ones. */
export const IMPLIED_SCOPES: Record<string, string[]> = {
  [SCOPES.calendarWrite]: [SCOPES.calendarRead],
  [SCOPES.gmailCompose]: [SCOPES.gmailSend],
};

export interface ToolSpec {
  name: string;
  version: string;
  description: string;
  category: string;
  provider: string;
  permission_level: PermissionLevel;
  risk_level: RiskLevel;
  requires_approval: boolean;
  required_scopes: string[];
  verification_method: string;
  output_trust: "controlled_agent_output" | "untrusted_external_content";
  parallel_safe: boolean;
  max_attempts: number;
  base_delay_seconds: number;
  feature_flag?: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
});
const str = (description?: string) => ({ type: "string", ...(description ? { description } : {}) });
const int = (description?: string) => ({ type: "integer", ...(description ? { description } : {}) });
const emails = { type: "array", items: { type: "string", format: "email" } };

function tool(partial: Partial<ToolSpec> & Pick<ToolSpec, "name" | "description" | "category">): ToolSpec {
  return {
    version: "v1",
    provider: "internal",
    permission_level: "read",
    risk_level: "low",
    requires_approval: false,
    required_scopes: [],
    verification_method: "output_schema",
    output_trust: "controlled_agent_output",
    parallel_safe: true,
    max_attempts: 3,
    base_delay_seconds: 2,
    input_schema: obj({}),
    output_schema: {},
    ...partial,
  };
}

const google = { provider: "google" } as const;
const untrusted = { output_trust: "untrusted_external_content" } as const;
const compose = obj({ to: emails, cc: emails, subject: str(), body: str() }, ["to", "subject", "body"]);

export const TOOL_CATALOGUE: ToolSpec[] = [
  tool({
    name: "calendar.list_events",
    description: "List calendar events in a time window",
    category: "calendar",
    ...google,
    ...untrusted,
    required_scopes: [SCOPES.calendarRead],
    input_schema: obj({
      date: str("YYYY-MM-DD, 'today' or 'tomorrow' (user's timezone)"),
      time_min: str(),
      time_max: str(),
      max_results: int(),
    }),
  }),
  tool({
    name: "calendar.find_free_slots",
    description: "Find free time slots of a given duration on a day (deterministic free/busy computation)",
    category: "calendar",
    ...google,
    required_scopes: [SCOPES.calendarRead],
    input_schema: obj(
      {
        date: str("YYYY-MM-DD, 'today' or 'tomorrow' in the user's timezone"),
        duration_minutes: int(),
        earliest_time: str("HH:MM local time; slots start at or after this"),
        latest_time: str("HH:MM local time; slots end at or before this"),
      },
      ["date", "duration_minutes"],
    ),
    output_schema: obj({
      slots: { type: "array", items: obj({ start: str(), end: str() }) },
      date: str(),
      timezone: str(),
      busy_count: int(),
    }),
  }),
  tool({
    name: "calendar.create_event",
    description: "Create a calendar event (optionally inviting attendees)",
    category: "calendar",
    ...google,
    permission_level: "write",
    risk_level: "medium",
    required_scopes: [SCOPES.calendarWrite],
    verification_method: "read_back",
    parallel_safe: false,
    input_schema: obj(
      {
        summary: str(),
        start: str("ISO-8601 datetime with UTC offset"),
        end: str("ISO-8601 datetime with UTC offset"),
        attendees: emails,
        description: str(),
        calendar_id: str(),
      },
      ["summary", "start", "end"],
    ),
    output_schema: obj({ event_id: str(), summary: str(), start: str(), end: str(), attendees: emails }),
  }),
  tool({
    name: "calendar.update_event",
    description: "Modify an existing calendar event (title/time/description)",
    category: "calendar",
    ...google,
    permission_level: "write",
    risk_level: "medium",
    requires_approval: true,
    required_scopes: [SCOPES.calendarWrite],
    verification_method: "read_back",
    parallel_safe: false,
    input_schema: obj({ event_id: str(), summary: str(), start: str(), end: str(), description: str() }, ["event_id"]),
  }),
  tool({
    name: "calendar.cancel_event",
    description: "Cancel (delete) a calendar event and notify attendees",
    category: "calendar",
    ...google,
    permission_level: "high_risk_write",
    risk_level: "high",
    requires_approval: true,
    required_scopes: [SCOPES.calendarWrite],
    verification_method: "read_back",
    parallel_safe: false,
    max_attempts: 2,
    input_schema: obj({ event_id: str(), send_updates: { type: "boolean" } }, ["event_id"]),
  }),
  tool({
    name: "gmail.search",
    description: "Search the mailbox and return message headers and snippets",
    category: "email",
    ...google,
    ...untrusted,
    required_scopes: [SCOPES.gmailRead],
    input_schema: obj({ query: str("Gmail search syntax, e.g. 'is:unread newer_than:1d'"), max_results: int() }, [
      "query",
    ]),
  }),
  tool({
    name: "gmail.read_message",
    description: "Read one e-mail's headers and plain-text body",
    category: "email",
    ...google,
    ...untrusted,
    required_scopes: [SCOPES.gmailRead],
    input_schema: obj({ message_id: str() }, ["message_id"]),
  }),
  tool({
    name: "gmail.send",
    description: "Send an e-mail from the user's mailbox",
    category: "email",
    ...google,
    permission_level: "high_risk_write",
    risk_level: "high",
    requires_approval: true,
    required_scopes: [SCOPES.gmailSend],
    verification_method: "provider_confirmation",
    parallel_safe: false,
    max_attempts: 2,
    input_schema: compose,
    output_schema: obj({ message_id: str(), thread_id: str(), to: emails, subject: str() }),
  }),
  tool({
    name: "gmail.create_draft",
    description: "Create an e-mail draft (not sent)",
    category: "email",
    ...google,
    permission_level: "write",
    risk_level: "low",
    required_scopes: [SCOPES.gmailCompose],
    verification_method: "read_back",
    parallel_safe: false,
    input_schema: compose,
    output_schema: obj({ draft_id: str(), subject: str() }),
  }),
  tool({
    name: "contacts.lookup",
    description: "Resolve a person's name to an e-mail address from the user's saved contacts or Google Contacts",
    category: "contacts",
    input_schema: obj({ name: str("Person's name as the user wrote it"), require_unique: { type: "boolean" } }, [
      "name",
    ]),
    output_schema: obj({
      query: str(),
      matches: { type: "array" },
      best: obj({ name: str(), email: str(), source: str() }),
    }),
  }),
  tool({
    name: "drive.search",
    description: "Search Google Drive files by content or name",
    category: "files",
    ...google,
    ...untrusted,
    required_scopes: [SCOPES.driveRead],
    input_schema: obj({ query: str("Full-text search terms"), max_results: int() }),
  }),
  tool({
    name: "drive.read_file",
    description: "Read the text content of a Google Drive document",
    category: "files",
    ...google,
    ...untrusted,
    required_scopes: [SCOPES.driveRead],
    input_schema: obj({ file_id: str() }, ["file_id"]),
  }),
  tool({
    name: "memory.search",
    description:
      "Recall relevant facts, preferences and contacts the user asked to remember (with freshness and confidence flags)",
    category: "memory",
    input_schema: obj({ query: str(), limit: int() }, ["query"]),
  }),
  tool({
    name: "memory.save",
    description: "Remember a durable fact, preference or contact for future tasks",
    category: "memory",
    permission_level: "write",
    verification_method: "read_back",
    parallel_safe: false,
    input_schema: obj({ content: str(), memory_type: str(), importance: { type: "number" }, subject_key: str() }, [
      "content",
    ]),
    output_schema: obj({ memory_id: str(), memory_type: str() }),
  }),
  tool({
    name: "search.web",
    description: "Search the web; returns ranked results with source citations",
    category: "search",
    provider: "web_search",
    ...untrusted,
    feature_flag: "web_search",
    input_schema: obj({ query: str(), max_results: int() }, ["query"]),
  }),
  tool({
    name: "web.fetch",
    description: "Fetch a public web page and return its readable text",
    category: "web",
    provider: "web",
    ...untrusted,
    input_schema: obj({ url: str() }, ["url"]),
  }),
  tool({
    name: "documents.search",
    description: "Search the user's indexed documents and files (keyword + semantic)",
    category: "search",
    ...untrusted,
    input_schema: obj({ query: str(), limit: int() }, ["query"]),
  }),
  tool({
    name: "files.list",
    description: "List the user's files (most recent first)",
    category: "files",
    ...untrusted,
    input_schema: obj({ limit: int() }),
  }),
  tool({
    name: "files.read_text",
    description: "Read the extracted text of one of the user's files",
    category: "files",
    ...untrusted,
    input_schema: obj({ file_id: str() }, ["file_id"]),
  }),
  tool({
    name: "files.write_text",
    description: "Create a new text, Markdown or CSV file for the user",
    category: "files",
    permission_level: "write",
    verification_method: "checksum",
    input_schema: obj({ filename: str(), format: { type: "string", enum: ["txt", "md", "csv"] }, content: str() }, [
      "filename",
      "content",
    ]),
  }),
  tool({
    name: "llm.generate_text",
    description: "Write or summarize text (e.g. an e-mail body or a summary) from provided data. No side effects.",
    category: "compute",
    provider: "model",
    input_schema: obj({ instruction: str("What text to produce"), inputs: { type: "object" } }, ["instruction"]),
  }),
  tool({
    name: "data.analyze",
    description: "Deterministic analysis of tabular data: filter, group_by with aggregates, sort, limit, describe",
    category: "compute",
    input_schema: obj({ rows: { type: "array" }, operations: { type: "array" } }, ["rows"]),
  }),
];

/** Feature flags that are off in the demo (the tool is listed but not usable). */
export const DISABLED_FLAGS = new Set(["web_search"]);
