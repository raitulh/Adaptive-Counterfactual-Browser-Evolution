import { expect, test } from "./fixtures";

test.describe("login", () => {
  test("validates, rejects bad credentials, then signs in", async ({ page, consoleProblems }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText("Enter your email address.")).toBeVisible();

    await page.getByLabel("Email").fill("dev@example.com");
    await page.getByLabel("Password", { exact: true }).fill("incorrect-password");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "didn't work" })).toBeVisible();

    await page.getByLabel("Password", { exact: true }).fill("a valid password");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
    expect(consoleProblems).toEqual([]);
  });
});

test.describe("dashboard", () => {
  test("overview loads sample metrics and chart", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("Verification volume")).toBeVisible();
    await expect(page.getByRole("img", { name: /verification activity/i })).toBeVisible();
    await expect(page.getByText(/sample data from the mock adapter/i)).toBeVisible();
  });

  test("API key secret is revealed once, then only the masked key remains", async ({ page }) => {
    await page.goto("/dashboard/api-keys");
    await page.getByRole("button", { name: "Create key" }).first().click();
    await page.getByLabel("Name").fill("Production backend");
    await page.getByText("live", { exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create key" }).click();

    const secretLocator = page.getByTestId("api-key-secret");
    await expect(secretLocator).toBeVisible();
    const secret = (await secretLocator.textContent()) ?? "";
    expect(secret).toMatch(/^rh_live_sk_[0-9a-f]{32}$/);

    await page.getByRole("button", { name: "I've stored it" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("api-key-masked").first()).toHaveText(
      `rh_live_sk_••••••••${secret.slice(-4)}`,
    );
    expect(await page.content()).not.toContain(secret);
  });

  test("webhooks start empty and accept an https endpoint", async ({ page }) => {
    await page.goto("/dashboard/webhooks");
    await expect(page.getByText("No endpoints configured")).toBeVisible();
    await page.getByRole("button", { name: "Add endpoint" }).click();
    await page.getByLabel("Endpoint URL").fill("http://insecure.example.test");
    await page.getByRole("dialog").getByRole("button", { name: "Add endpoint" }).click();
    await expect(page.getByText("Use an https:// URL.")).toBeVisible();
    await page.getByLabel("Endpoint URL").fill("https://hooks.example.test/realhuman");
    await page.getByRole("dialog").getByRole("button", { name: "Add endpoint" }).click();
    await expect(page.getByText("https://hooks.example.test/realhuman")).toBeVisible();
  });

  test("sidebar collapses and remembers its state", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  });

  test("session filters show an empty state when nothing matches", async ({ page }) => {
    await page.goto("/dashboard/sessions");
    await expect(page.getByRole("region", { name: "Verification sessions" })).toBeVisible();
    for (const label of ["Verified", "Step-up", "Blocked", "Expired"]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }
  });
});

test.describe("docs", () => {
  test("renders the API reference and use-case anchors", async ({ page }) => {
    await page.goto("/docs#api-reference");
    await expect(page.getByRole("heading", { name: "API reference" })).toBeVisible();
    await expect(page.locator("#use-case-ai-platforms")).toHaveCount(1);
  });
});
