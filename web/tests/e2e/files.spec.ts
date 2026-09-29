import { expect, test } from "./fixtures";

test("upload a document, watch it become ready, and get a signed download link", async ({ authedPage: page }) => {
  await page.goto("/app/files");
  const content = "Quarterly planning notes\nThe Q3 launch moved to October.\n".repeat(20);
  await page.locator('input[type="file"]').setInputFiles({
    name: "q3-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(content),
  });

  const row = page.getByRole("row").filter({ hasText: "q3-notes.txt" }).first();
  await expect(row).toBeVisible();
  // Scan + extraction happen in the backend; the list reflects its state, polling only while processing.
  await expect(row.getByText("Ready", { exact: true }).first()).toBeVisible({ timeout: 45_000 });

  await row.getByText("q3-notes.txt").click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(/sha-?256/i).first()).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await sheet.getByRole("button", { name: "Download" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("q3-notes.txt");
  // Signed, short-lived URL minted by the backend — never the user's access token.
  expect(download.url()).toMatch(/\/api\/v1\/files\/download\?token=/);
});
