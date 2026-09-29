import { appShell, expect, expectNoTokensInStorage, newUser, signIn, signOut, signUp, test } from "./fixtures";

test.describe("authentication", () => {
  test("sign up, keep the session across reloads, sign out and sign back in", async ({ page, context }) => {
    const user = newUser("auth");
    await signUp(page, user);

    // Refresh token: HttpOnly cookie scoped to the auth API. Access token: memory only.
    const cookies = await context.cookies();
    const refresh = cookies.find((c) => c.name === "agentos_refresh");
    expect(refresh?.httpOnly).toBe(true);
    expect(refresh?.path).toBe("/api/v1/auth");
    expect(refresh?.sameSite).toBe("Strict");
    await expectNoTokensInStorage(page);

    await page.reload();
    await expect(appShell(page)).toBeVisible();

    await signOut(page);
    expect((await context.cookies()).find((c) => c.name === "agentos_refresh")).toBeUndefined();

    await page.goto("/app");
    await page.waitForURL(/\/login/);
    await signIn(page, user);
    await page.waitForURL(/\/app(\/|$|\?)/);
    await expect(appShell(page)).toBeVisible();
    await expectNoTokensInStorage(page);
  });

  test("protected pages redirect to sign-in and return afterwards", async ({ page }) => {
    const user = newUser("next");
    await signUp(page, user);
    await signOut(page);

    await page.goto("/app/approvals");
    await page.waitForURL(/\/login\?.*next=%2Fapp%2Fapprovals/);
    await signIn(page, user);
    await page.waitForURL(/\/app\/approvals/);
  });

  test("wrong credentials show a clear error and never leak the password into the URL", async ({ page }) => {
    await page.goto("/login");
    await signIn(page, { email: "nobody@example.com", password: "definitely-wrong-password" });
    await expect(page.getByRole("alert").filter({ hasText: "Incorrect email or password" })).toBeVisible();
    expect(page.url()).not.toContain("definitely-wrong-password");
    expect(page.url()).toMatch(/\/login/);
  });
});
