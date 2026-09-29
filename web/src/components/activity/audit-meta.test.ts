import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  auditStatusTone,
  EMPTY_FILTERS,
  filtersFromParams,
  filtersToParams,
  filtersToQuery,
} from "./audit-meta";

const TASK = "01a0eb8c-e6c3-7433-8345-6e76ae7ea4af";

describe("audit filters ↔ URL ↔ API query", () => {
  it("reads valid filters from the URL and drops values the API would reject", () => {
    const f = filtersFromParams(
      new URLSearchParams(`category=security&action=auth.login&task_id=${TASK.toUpperCase()}&user_id=not-a-uuid`),
    );
    expect(f).toEqual({ category: "security", action: "auth.login", task_id: TASK, user_id: null });
    expect(filtersFromParams(new URLSearchParams(`action=${"x".repeat(101)}`)).action).toBeNull();
  });

  it("writes filters back to the URL, preserving unrelated params", () => {
    const qs = filtersToParams({ ...EMPTY_FILTERS, category: "auth" }, new URLSearchParams("tab=x&action=old"));
    expect(qs.get("category")).toBe("auth");
    expect(qs.has("action")).toBe(false);
    expect(qs.get("tab")).toBe("x");
  });

  it("builds the API query with only set filters", () => {
    expect(filtersToQuery(EMPTY_FILTERS)).toEqual({ limit: 50 });
    expect(filtersToQuery({ ...EMPTY_FILTERS, task_id: TASK, action: "task.create" }, 100)).toEqual({
      limit: 100,
      task_id: TASK,
      action: "task.create",
    });
    expect(activeFilterCount({ ...EMPTY_FILTERS, category: "task", user_id: TASK })).toBe(2);
  });

  it("maps recorded statuses to tones", () => {
    expect(auditStatusTone("success")).toBe("success");
    expect(auditStatusTone("denied")).toBe("danger");
    expect(auditStatusTone("waiting_approval")).toBe("warning");
    expect(auditStatusTone("something_new")).toBe("neutral");
  });
});
