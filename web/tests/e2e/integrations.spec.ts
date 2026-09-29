import { expect, test } from "./fixtures";

test("connect Google Workspace through the backend OAuth flow", async ({ authedPage: page }) => {
  await page.goto("/app/integrations");
  await page.getByRole("button", { name: "Connect Google" }).click();

  // Backend-generated authorization URL → (simulated) Google consent → backend callback →
  // back to the integrations page with ?status=connected, which the page consumes.
  await page.waitForURL(/\/app\/integrations/);
  await expect(page.getByText("owner@example.com")).toBeVisible();
  await expect(page.getByText("Connected", { exact: true }).first()).toBeVisible();
  await expect(page).not.toHaveURL(/status=connected/);

  // Health check asks the backend (token refresh against the provider), not local state.
  await page.getByRole("button", { name: "Check now" }).first().click();
  await expect(page.getByText("Connected", { exact: true }).first()).toBeVisible();
});
