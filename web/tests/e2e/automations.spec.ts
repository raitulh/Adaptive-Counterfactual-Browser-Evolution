import { expect, test } from "./fixtures";

test("create an automation and run it now: it creates a real task", async ({ authedPage: page }) => {
  await page.goto("/app/automations");
  await page.getByRole("button", { name: "New automation" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Morning inbox check");
  await dialog.getByLabel("Goal").fill("What's unread in my inbox?");
  await dialog.getByRole("button", { name: "Create automation" }).click();
  await expect(dialog).toBeHidden();

  // Saving opens the automation's page.
  await expect(page.getByRole("heading", { level: 1, name: "Morning inbox check" })).toBeVisible();
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByText(/Run (started|finished)/).first()).toBeVisible();
  await page.getByRole("button", { name: "Open task" }).click();
  await page.waitForURL(/\/app\/tasks\/[0-9a-f-]{36}/);
});
