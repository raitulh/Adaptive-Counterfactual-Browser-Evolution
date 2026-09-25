import { expect, holdToVerify, startDemo, test } from "./fixtures";

test.describe("interactive verification demo", () => {
  test("success: pointer hold verifies and enables the form", async ({ page, consoleProblems }) => {
    await startDemo(page);
    const hold = page.getByRole("button", { name: /press and hold to verify/i });
    const box = await hold.boundingBox();
    if (!box) throw new Error("hold button not visible");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1300);
    await page.mouse.up();

    await expect(page.getByText("Analyzing signals…")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Human verified" })).toBeVisible();
    await expect(page.getByText("0.93 · allow")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();
    // The token is only ever displayed masked — in the widget and in the console payload.
    await expect(page.getByText(/^token rh_vt_demo_••••••••[0-9a-f]{4}$/)).toBeVisible();
    await expect(page.getByText(/rh_vt_demo_[0-9a-f]{20}/)).toHaveCount(0);
    expect(consoleProblems).toEqual([]);
  });

  test("single-step alternative challenge works without holding", async ({ page }) => {
    await startDemo(page);
    await page.getByRole("button", { name: "Use a single-step challenge instead" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Human verified" })).toBeVisible();
    await expect(page.getByText("input assistive")).toBeVisible();
  });

  test("step-up: inconclusive signals ask for another challenge, then verify", async ({ page }) => {
    await page.goto("/#demo");
    await page.getByText("Step-up", { exact: true }).click();
    await page.getByRole("button", { name: /verify you're human/i }).click();
    await holdToVerify(page);
    await expect(page.getByText("One more check needed")).toBeVisible();
    await expect(page.getByText("0.68 · step_up")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await holdToVerify(page);
    await expect(page.getByRole("status").filter({ hasText: "Human verified" })).toBeVisible();
  });

  test("network error: shows a recoverable error and retries", async ({ page }) => {
    await page.goto("/#demo");
    await page.getByText("Network error", { exact: true }).click();
    await page.getByRole("button", { name: /verify you're human/i }).click();
    await holdToVerify(page);
    await expect(page.getByText("Couldn't reach the verification service")).toBeVisible();
    await page.getByRole("button", { name: "Retry" }).click();
    await holdToVerify(page);
    await expect(page.getByRole("status").filter({ hasText: "Human verified" })).toBeVisible();
  });

  test("timeout: session expires mid-analysis and can start over", async ({ page }) => {
    await page.goto("/#demo");
    await page.getByText("Timeout", { exact: true }).click();
    await page.getByRole("button", { name: /verify you're human/i }).click();
    await holdToVerify(page);
    await expect(page.getByText("Session expired")).toBeVisible();
    await expect(page.getByText("session.expired")).toBeVisible();
    await page.getByRole("button", { name: "Start over" }).click();
    await holdToVerify(page);
    await expect(page.getByRole("status").filter({ hasText: "Human verified" })).toBeVisible();
  });

  test("releasing early does not complete the challenge", async ({ page }) => {
    await startDemo(page);
    const hold = page.getByRole("button", { name: /press and hold to verify/i });
    await hold.focus();
    await page.keyboard.down("Space");
    await page.waitForTimeout(250);
    await page.keyboard.up("Space");
    await page.waitForTimeout(1200);
    await expect(page.getByRole("button", { name: /press and hold to verify/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create account" })).toBeDisabled();
  });
});
