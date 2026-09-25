import { expect, test as base, type Page } from "@playwright/test";

/**
 * Collects console errors, page errors and React hydration warnings so every
 * test can assert a clean console.
 */
export const test = base.extend<{ consoleProblems: string[] }>({
  // The fixture callback is named `provide` (not `use`) to keep React hook lint rules quiet.
  consoleProblems: async ({ page }, provide) => {
    const problems: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (message.type() === "error" || /hydrat/i.test(text))
        problems.push(`${message.type()}: ${text}`);
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    await provide(problems);
  },
});

export { expect };

export async function startDemo(page: Page) {
  await page.goto("/#demo");
  await page.getByRole("button", { name: /verify you're human/i }).click();
  await expect(page.getByRole("button", { name: /press and hold to verify/i })).toBeVisible();
}

/** Completes the press-and-hold challenge with the keyboard (Space held ~1.3s). */
export async function holdToVerify(page: Page) {
  const hold = page.getByRole("button", { name: /press and hold to verify/i });
  await hold.focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(1300);
  await page.keyboard.up("Space");
}
