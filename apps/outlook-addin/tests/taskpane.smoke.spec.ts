import { expect, test } from "@playwright/test";

test.describe("task pane smoke (mock host)", () => {
  test("renders navigation and mock banner", async ({ page }) => {
    await page.goto("/taskpane.html");
    await expect(page.getByText(/SComm|Message|Diagnostics/i).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
