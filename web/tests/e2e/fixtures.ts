import { test as base, expect, type Page } from "@playwright/test";

export interface TestUser {
  name: string;
  email: string;
  password: string;
  organization: string;
}

export function newUser(label = "user"): TestUser {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return {
    name: `E2E ${label}`,
    email: `e2e-${label}-${id}@example.com`,
    password: `Correct-horse-${id}`,
    organization: `E2E ${label} ${id}`,
  };
}

/** Registers through the real sign-up form and waits for the authenticated app shell. */
export async function signUp(page: Page, user: TestUser): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill(user.name);
  await page.getByLabel("Work email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByLabel("Organization name").fill(user.organization);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/app(\/|$|\?)/);
  await expect(appShell(page)).toBeVisible();
}

/** The signed-in shell's entry point: the account menu (desktop) or the navigation drawer button (phones). */
export function appShell(page: Page) {
  return page
    .locator('button[aria-label="Account menu"]:visible, button[aria-label="Open navigation"]:visible')
    .first();
}

export async function signIn(page: Page, user: Pick<TestUser, "email" | "password">): Promise<void> {
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

export async function signOut(page: Page): Promise<void> {
  const drawer = page.getByRole("button", { name: "Open navigation" });
  if (await drawer.isVisible()) await drawer.click();
  await page.locator('button[aria-label="Account menu"]:visible').first().click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/);
}

/** Fails the test if any browser storage holds something that looks like a token. */
export async function expectNoTokensInStorage(page: Page): Promise<void> {
  const storage = await page.evaluate(() =>
    JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
  );
  expect(storage).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./); // JWT
  expect(storage.toLowerCase()).not.toContain("refresh_token");
  expect(storage.toLowerCase()).not.toContain("access_token");
}

type Fixtures = { user: TestUser; authedPage: Page };

/** `authedPage`: a fresh user (own organization) signed in through the UI — tests never share data. */
export const test = base.extend<Fixtures>({
  user: async ({}, provide, testInfo) => {
    await provide(
      newUser(
        testInfo.title
          .replace(/[^a-z0-9]+/gi, "-")
          .toLowerCase()
          .slice(0, 20),
      ),
    );
  },
  authedPage: async ({ page, user }, provide) => {
    await signUp(page, user);
    await provide(page);
  },
});

export { expect };

/**
 * Connects the (simulated) Google Workspace account through the real backend OAuth flow.
 * The page preselects least-privilege read capabilities; tasks that write also need these.
 */
export async function connectGoogle(page: Page, extra: string[] = ["Manage events", "Send mail"]): Promise<void> {
  await page.goto("/app/integrations");
  for (const label of extra) {
    const box = page.getByRole("checkbox", { name: new RegExp(`^${label}`) });
    if ((await box.getAttribute("aria-checked")) !== "true") await box.click();
  }
  await page.getByRole("button", { name: "Connect Google" }).click();
  await page.waitForURL(/\/app\/integrations/);
  await expect(page.getByText("owner@example.com")).toBeVisible();
}

/** Submits a goal from the Command Center and waits for the task page. Returns the task id. */
export async function runGoal(page: Page, goal: string): Promise<string> {
  await page.goto("/app");
  await page.getByLabel("What do you want done?").fill(goal);
  await page.getByRole("button", { name: "Run task" }).click();
  await page.waitForURL(/\/app\/tasks\/[0-9a-f-]{36}/, { timeout: 30_000 });
  return page.url().split("/").pop()!.split("?")[0]!;
}

/** Task status as announced by the task page (the page never reloads: it is driven by live events). */
export function taskStatus(page: Page, label: string) {
  return page.getByText(`Task status: ${label}.`, { exact: false });
}

/** Approves the next pending action on the task page, typing the confirmation phrase when asked. */
export async function approveNext(page: Page): Promise<void> {
  const approve = page.getByRole("button", { name: "Approve", exact: true }).first();
  await expect(approve).toBeVisible({ timeout: 45_000 });
  await approve.click();
  const dialog = page.getByRole("alertdialog");
  if (await dialog.isVisible().catch(() => false)) {
    const typed = dialog.getByLabel(/to confirm/);
    if (await typed.count()) {
      const phrase = await dialog.locator("label .font-mono").first().innerText();
      await typed.fill(phrase);
    }
    await dialog.getByRole("button", { name: "Approve and run" }).click();
    await expect(dialog).toBeHidden();
  }
}
