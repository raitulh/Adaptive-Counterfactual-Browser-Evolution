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
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
}

export async function signIn(page: Page, user: Pick<TestUser, "email" | "password">): Promise<void> {
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/);
}

/** Fails the test if any browser storage holds something that looks like a token. */
export async function expectNoTokensInStorage(page: Page): Promise<void> {
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./); // JWT
  expect(storage.toLowerCase()).not.toContain("refresh_token");
  expect(storage.toLowerCase()).not.toContain("access_token");
}

type Fixtures = { user: TestUser; authedPage: Page };

/** `authedPage`: a fresh user (own organization) signed in through the UI — tests never share data. */
export const test = base.extend<Fixtures>({
  user: async ({}, provide, testInfo) => {
    await provide(newUser(testInfo.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 20)));
  },
  authedPage: async ({ page, user }, provide) => {
    await signUp(page, user);
    await provide(page);
  },
});

export { expect };
