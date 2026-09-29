import { approveNext, connectGoogle, expect, runGoal, taskStatus, test } from "./fixtures";

test.describe("task lifecycle", () => {
  // In order, in one worker: the simulated Google Workspace is shared by every user of the backend,
  // and the "flaky" scenario injects a fixed number of Calendar 503s that concurrent meeting tasks
  // would otherwise consume. Each test still passes or fails on its own.
  test.describe.configure({ mode: "default" });

  test("goal → plan → approvals → execution → verified completion, live", async ({ authedPage: page }) => {
    await connectGoogle(page);
    await runGoal(page, "Schedule a 30 minute meeting with Rahim tomorrow afternoon and email him a confirmation");

    await expect(page.getByRole("status").filter({ hasText: /^Live/ })).toBeVisible({ timeout: 30_000 });
    await expect(taskStatus(page, "Needs approval")).toBeAttached({ timeout: 45_000 });
    await approveNext(page); // calendar.create_event
    await approveNext(page); // gmail.send (high risk: typed confirmation)

    await expect(taskStatus(page, "Completed")).toBeAttached({ timeout: 60_000 });
    await expect(page.getByText(/verified/i).first()).toBeVisible();
    // The backend ends the stream at a resting state.
    await expect(page.getByRole("status").filter({ hasText: /^Stream ended/ })).toBeVisible();
  });

  test("the agent asks for missing information and continues with the answer", async ({ authedPage: page }) => {
    await connectGoogle(page);
    await runGoal(page, "Schedule a meeting with Zoe tomorrow afternoon");

    await expect(taskStatus(page, "Needs input")).toBeAttached({ timeout: 45_000 });
    await page.getByLabel("Your answer").fill("zoe@example.com");
    await page.getByRole("button", { name: "Send answer" }).click();

    await approveNext(page);
    await approveNext(page);
    await expect(taskStatus(page, "Completed")).toBeAttached({ timeout: 60_000 });
  });

  test("a failed step is explained and the task resumes from where it stopped", async ({ authedPage: page }) => {
    await connectGoogle(page);
    await runGoal(page, "flaky: schedule a meeting with Sara tomorrow afternoon");

    // Calendar returns 503 three times: retried with backoff, then the step fails.
    await expect(taskStatus(page, "Failed")).toBeAttached({ timeout: 90_000 });
    await page.getByRole("button", { name: "Resume", exact: true }).first().click();

    await approveNext(page);
    await approveNext(page);
    await expect(taskStatus(page, "Completed")).toBeAttached({ timeout: 60_000 });
  });

  test("rejecting an action requires a reason and stops that action", async ({ authedPage: page }) => {
    await connectGoogle(page);
    await runGoal(page, "Send Omar an email saying the report is ready");

    const reject = page.getByRole("button", { name: "Reject", exact: true }).first();
    await expect(reject).toBeVisible({ timeout: 45_000 });
    await reject.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill("Not now — I'll tell him myself.");
    await dialog.getByRole("button", { name: "Reject action" }).click();
    await expect(taskStatus(page, "Failed")).toBeAttached({ timeout: 45_000 });
  });
});
