import { expect, test } from "./fixtures";

test("remember something, recall it by meaning, and verify it", async ({ authedPage: page }) => {
  await page.goto("/app/memory");
  await page.getByRole("button", { name: "Remember something" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("What should AgentOS remember?").fill("I prefer 30-minute meetings before noon.");
  await dialog.getByRole("button", { name: "Remember", exact: true }).click();
  await expect(page.getByText("Remembered").first()).toBeVisible();

  await page.getByLabel("What do you remember about me?").fill("meeting preferences");
  await page.getByRole("button", { name: "Recall" }).click();
  const result = page.getByRole("listitem").filter({ hasText: "30-minute meetings before noon" }).first();
  await expect(result).toBeVisible();

  await result.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("Memory verified").first()).toBeVisible();
  await expect(result.getByText(/Verified/)).toBeVisible();
});

test("secrets are refused by the backend and the reason is shown", async ({ authedPage: page }) => {
  await page.goto("/app/memory");
  await page.getByRole("button", { name: "Remember something" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("What should AgentOS remember?").fill("My bank password is hunter2-hunter2");
  await dialog.getByRole("button", { name: "Remember", exact: true }).click();
  await expect(dialog.getByRole("alert").first()).toBeVisible();
  await expect(dialog).toBeVisible();
});
