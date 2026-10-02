import { test, expect } from "@playwright/test";

test("catalog is branded Builders and lists agents", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Builders/);
  await expect(page.getByRole("heading", { name: /Prompt in/ })).toBeVisible();
  await expect(page.locator('a[href^="/agent/"]').first()).toBeVisible();
});

test("email sign-in, run an agent from the UI, see files and preview", async ({ page }) => {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(`ui-${Date.now()}@example.com`);
  await page.getByRole("button", { name: /magic link/i }).click();
  await page.getByText(/DEV_MODE:/).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/agent/landing-forge");
  await page.getByLabel("What should this agent build?").fill("build a one-page todo app");
  await page.getByRole("button", { name: /^Run/ }).click();
  await expect(page).toHaveURL(/\/run\//);
  await expect(page.getByText("completed").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("link", { name: /Download zip/ })).toBeVisible();
  await expect(page.frameLocator('iframe[title="Preview"]').getByRole("button", { name: "Add" })).toBeVisible();
});
