import { expect, test } from "./fixtures";

test.describe("mobile", () => {
  test("navigation drawer traps focus, locks scroll and closes with Escape", async ({ page }) => {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Open menu" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Menu" });
    await expect(dialog).toBeVisible();
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");

    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      const inside = await dialog.evaluate((node) => node.contains(document.activeElement));
      expect(inside).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("drawer links navigate and close the menu", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Pricing" }).click();
    await expect(page).toHaveURL(/#pricing$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("hero CTA is visible above the fold and nothing overflows horizontally", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page
        .getByRole("main")
        .getByRole("link", { name: /start building/i })
        .first(),
    ).toBeInViewport();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("demo completes with touch-sized controls", async ({ page }) => {
    await page.goto("/#demo");
    await page.getByRole("button", { name: /verify you're human/i }).click();
    await page.getByRole("button", { name: "Use a single-step challenge instead" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Human verified" })).toBeVisible();
  });
});
