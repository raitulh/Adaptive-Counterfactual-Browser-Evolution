import { expect, test } from "./fixtures";

test("app shell works on a phone: navigation drawer, no horizontal scroll", async ({ authedPage: page }) => {
  await page.getByRole("button", { name: "Open navigation" }).click();
  const nav = page.getByRole("dialog");
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Approvals" }).click();
  await page.waitForURL(/\/app\/approvals/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("the landing page renders its primary call to action on a phone", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
