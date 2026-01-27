import { test, expect } from "@playwright/test";

test.describe("Homepage", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should display the Morocco Eats branding", async ({ page }) => {
    await expect(page.getByRole("link", { name: /morocco eats/i })).toBeVisible();
  });

  test("should have a working search form", async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search for restaurants/i);
    await expect(searchInput).toBeVisible();

    await searchInput.fill("tagine");
    await searchInput.press("Enter");

    await expect(page).toHaveURL(/\/search\?q=tagine/);
  });

  test("should display city picker section", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /explore by city/i })).toBeVisible();
  });

  test("should display popular dishes section", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /popular dishes/i })).toBeVisible();
  });

  test("should have a Near Me button", async ({ page }) => {
    await expect(page.getByRole("button", { name: /find food near me/i })).toBeVisible();
  });

  test("should navigate to search page when clicking Search link", async ({ page }) => {
    await page.getByRole("link", { name: "Search" }).click();
    await expect(page).toHaveURL("/search");
  });
});
