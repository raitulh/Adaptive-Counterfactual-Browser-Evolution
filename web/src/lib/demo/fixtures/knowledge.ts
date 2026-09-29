/** Memories of every type (varied confidence and freshness) and files (ready + processing). */
import type { DemoStore, FileRec, MemoryRec } from "../server/store";
import { DAY, hash64, HOUR, iso, MINUTE, seedId } from "../server/util";

export const PROCESSING_FILE_ID = seedId(0x31, 5);

export function seedMemories(store: DemoStore, now: number): void {
  const userId = store.me.id;
  const m = (
    n: number,
    content: string,
    memory_type: string,
    opts: Partial<MemoryRec> & { verifiedDaysAgo?: number; createdDaysAgo?: number } = {},
  ): MemoryRec => {
    const created = iso(now - (opts.createdDaysAgo ?? opts.verifiedDaysAgo ?? 10) * DAY);
    const { verifiedDaysAgo, createdDaysAgo, ...rest } = opts;
    void createdDaysAgo;
    return {
      id: seedId(0x30, n),
      userId,
      content,
      memory_type,
      subject_key: null,
      confidence: 1,
      importance: 0.7,
      source_type: "user_stated",
      source_reference: `user:${userId}`,
      status: "active",
      superseded_by: null,
      created_at: created,
      updated_at: created,
      last_verified_at: iso(now - (verifiedDaysAgo ?? 10) * DAY),
      expires_at: null,
      last_accessed_at: iso(now - 2 * DAY),
      access_count: 3,
      ...rest,
    };
  };
  store.memories = [
    m(1, "Prefers meetings after 2 PM on weekdays; mornings are for focused work.", "preference", {
      subject_key: "pref:meeting_time",
      importance: 0.8,
      verifiedDaysAgo: 12,
      access_count: 14,
    }),
    m(2, "Prefers morning meetings.", "preference", {
      subject_key: "pref:meeting_time",
      status: "superseded",
      superseded_by: seedId(0x30, 1),
      createdDaysAgo: 70,
      verifiedDaysAgo: 70,
      access_count: 2,
    }),
    m(3, "Keep e-mails short and sign off with “Best regards”.", "preference", {
      subject_key: "pref:email_style",
      verifiedDaysAgo: 30,
      access_count: 9,
    }),
    m(4, "Rahim Uddin — rahim@example.org (partner lead at Example Org).", "contact", {
      subject_key: "contact:rahim:email",
      confidence: 0.95,
      source_type: "task",
      source_reference: "task:contacts.lookup",
      verifiedDaysAgo: 6,
      access_count: 11,
    }),
    m(5, "Omar Haddad — omar@example.net.", "contact", {
      subject_key: "contact:omar:email",
      confidence: 0.9,
      source_type: "tool_result",
      source_reference: "google_contacts",
      verifiedDaysAgo: 14,
    }),
    m(6, "Omar Haddad — omar.h@legacy.example.net.", "contact", {
      subject_key: "contact:omar:email",
      confidence: 0.55,
      status: "conflicted",
      source_type: "extraction",
      source_reference: "email:18f1c0e2",
      verifiedDaysAgo: 200,
      createdDaysAgo: 200,
    }),
    m(7, "The Q3 planning review is on October 14.", "verified_fact", {
      confidence: 0.9,
      source_type: "extraction",
      source_reference: "file:Q3-planning-notes.md",
      verifiedDaysAgo: 120,
      createdDaysAgo: 120,
      importance: 0.6,
    }),
    m(8, "Northwind's fiscal year starts in February.", "semantic", {
      confidence: 0.85,
      source_type: "import",
      source_reference: "import:onboarding",
      verifiedDaysAgo: 60,
      importance: 0.5,
    }),
    m(9, "Works on the AgentOS launch with Sara Chen (growth) and Omar Haddad (marketing).", "long_term", {
      verifiedDaysAgo: 20,
      importance: 0.75,
    }),
    m(10, "Scheduled a 30-minute sync with Sara Chen; she prefers video calls.", "task_history", {
      confidence: 0.8,
      source_type: "task",
      source_reference: "task:meeting-with-sara",
      verifiedDaysAgo: 6,
      importance: 0.4,
    }),
    m(11, "Mentioned possibly switching the standup to 9:30 — not confirmed.", "conversational", {
      confidence: 0.35,
      source_type: "extraction",
      source_reference: "conversation",
      verifiedDaysAgo: 2,
      importance: 0.3,
      expires_at: iso(now + 5 * DAY),
    }),
    m(12, "Travelling in Lisbon until Friday; keep meetings remote.", "short_term", {
      verifiedDaysAgo: 0.2,
      createdDaysAgo: 0.2,
      importance: 0.6,
      expires_at: iso(now + 20 * HOUR),
    }),
  ];
}

const NOTES = `# Q3 planning notes

## Goals
- Launch AgentOS to design partners by October 14.
- Reach 40 weekly active teams; keep false-completion rate at 0%.

## Risks
- Calendar provider rate limits during peak hours (seen in September).
- Approval fatigue: batch low-risk approvals where policy allows.

## Owners
- Sara Chen — launch checklist, docs review.
- Omar Haddad — marketing timeline and announcement.
`;

export function seedFiles(store: DemoStore, now: number): void {
  const userId = store.me.id;
  const f = (
    n: number,
    filename: string,
    content_type: string,
    size: number,
    minutesAgo: number,
    extra: Partial<FileRec> = {},
  ): FileRec => {
    const created = iso(now - minutesAgo * MINUTE);
    return {
      id: seedId(0x31, n),
      user_id: userId,
      filename,
      content_type,
      size_bytes: size,
      sha256: hash64(filename),
      purpose: "user_upload",
      scan_status: "clean",
      status: "ready",
      task_id: null,
      expires_at: null,
      created_at: created,
      updated_at: created,
      metadata: {
        extraction_status: "completed",
        char_count: Math.round(size * 0.9),
        chunk_count: Math.max(1, Math.round(size / 3000)),
        language: "en",
        page_count: null,
        extracted_summary: null,
      },
      blob: null,
      text: null,
      ...extra,
    };
  };
  store.files = [
    f(1, "Q3-planning-notes.md", "text/markdown", NOTES.length, 9 * 24 * 60, {
      text: NOTES,
      metadata: {
        extraction_status: "completed",
        char_count: NOTES.length,
        chunk_count: 2,
        language: "en",
        page_count: null,
        extracted_summary: "Q3 goals (launch to design partners by Oct 14), risks and owners.",
      },
    }),
    f(2, "customer-interviews-summary.pdf", "application/pdf", 2_418_220, 6 * 24 * 60, {
      text: "Customer interviews (12 teams): the top request is reliable scheduling across time zones; second is audit trails for every external action.",
      metadata: {
        extraction_status: "completed",
        char_count: 48_210,
        chunk_count: 38,
        language: "en",
        page_count: 14,
        extracted_summary: "12 interviews; top requests: reliable cross-timezone scheduling and audit trails.",
      },
    }),
    f(3, "pricing-model.csv", "text/csv", 5_380, 4 * 24 * 60, {
      text: "plan,seats,price_usd\nfree,1,0\npro,1,29\nteam,10,240\n",
      metadata: {
        extraction_status: "completed",
        char_count: 5_380,
        chunk_count: 2,
        language: null,
        page_count: null,
        extracted_summary: "Plan pricing table (free, pro, team).",
      },
    }),
    f(4, "meeting-notes-2026-09-23.md", "text/markdown", 1_942, 6 * 24 * 60 - 30, {
      purpose: "task_artifact",
      text: "# Sync with Sara Chen\n\n- Launch checklist owners confirmed.\n- Status page: Demo User.\n",
      metadata: {
        extraction_status: "completed",
        char_count: 1_942,
        chunk_count: 1,
        language: "en",
        page_count: null,
        extracted_summary: "Notes from the sync with Sara Chen.",
      },
    }),
    f(
      5,
      "board-deck-draft.pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      6_812_004,
      1,
      {
        status: "processing",
        metadata: {
          extraction_status: "pending",
          char_count: null,
          chunk_count: null,
          language: null,
          page_count: null,
          extracted_summary: null,
        },
      },
    ),
  ];
}
