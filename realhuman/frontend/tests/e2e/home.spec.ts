import { expect, test } from "./fixtures";

test.describe("landing page", () => {
  test("renders the hero with one h1 and a clean console", async ({ page, consoleProblems }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Know when you are talking to a human.",
    );
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

    // Scroll the whole page so every lazy section and animation mounts.
    const height = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < height; y += 700) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(60);
    }
    await expect(page.getByRole("heading", { name: /build for humans/i })).toBeVisible();
    expect(consoleProblems).toEqual([]);
  });

  test("primary CTA leads to account creation", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("main")
      .getByRole("link", { name: /start building/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/login\?mode=signup$/);
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  });

  test("View Demo scrolls to the interactive demo", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "View Demo" }).click();
    await expect(page).toHaveURL(/#demo$/);
    await expect(
      page.getByRole("heading", { name: "See a verification happen." }),
    ).toBeInViewport();
  });

  test("skip link moves focus to the main content", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
  });

  test("nav and footer links resolve", async ({ page, request }) => {
    await page.goto("/");
    const hrefs = await page
      .locator("header a[href], footer a[href]")
      .evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute("href") ?? ""))]);
    for (const href of hrefs.filter((h) => h.startsWith("/"))) {
      const [path, hash] = href.split("#");
      const response = await request.get(path || "/");
      expect(response.status(), href).toBe(200);
      if (hash) {
        await page.goto(href);
        await expect(page.locator(`[id="${hash}"]`), href).toHaveCount(1);
      }
    }
  });

  test("FAQ accordion is keyboard operable", async ({ page }) => {
    await page.goto("/#faq");
    const trigger = page.getByRole("button", { name: "Is biometrics required?" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText(/does not require face scans/i)).toBeVisible();
  });

  test("copies code examples", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/#developers");
    await page.getByRole("button", { name: "Copy Node.js example" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("realhuman.verify(token)");
  });

  test("contact dialog lazy-loads its form, validates and confirms", async ({
    page,
    consoleProblems,
  }) => {
    await page.goto("/#pricing");
    await page.getByRole("button", { name: "Talk to us" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Send request" }).click();
    await expect(dialog.getByText("Enter your name.")).toBeVisible();
    await dialog.getByLabel("Name").fill("Ada Lovelace");
    await dialog.getByLabel("Work email").fill("ada@example.com");
    await dialog.getByRole("button", { name: "Send request" }).click();
    await expect(dialog.getByText("Request received")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(consoleProblems).toEqual([]);
  });

  test("unknown routes render the 404 page", async ({ page }) => {
    const response = await page.goto("/definitely-not-a-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /could not be verified/i })).toBeVisible();
  });
});

test.describe("reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("shows the final verified state without animating the sequence", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /replay sequence/i })).toHaveCount(0);
    await expect(page.getByText("Human verified", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
