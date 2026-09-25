import { expect, test } from "./fixtures";

test("hero uses the static SVG visual when WebGL is unavailable", async ({
  page,
  consoleProblems,
}) => {
  await page.goto("/");
  await page.waitForTimeout(2500);
  await expect(page.getByTestId("orb-fallback")).toBeVisible();
  await expect(page.getByTestId("orb-canvas")).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(consoleProblems).toEqual([]);
});
