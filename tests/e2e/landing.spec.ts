import { expect, test } from "@playwright/test";
import { shot, trackErrors } from "./helpers";

test.describe("Public pages", () => {
  test("landing page explains FLUENT and offers Google sign-in", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Your inbox");
    await expect(page.getByRole("link", { name: "Sign in with Google" }).first()).toHaveAttribute("href", /\/api\/auth\/google\/start/);
    await expect(page.getByRole("heading", { name: "Summaries that get to the point" })).toBeVisible();
    await shot(page, "01-landing-desktop");
    await page.getByRole("link", { name: "Read the privacy policy" }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
    await expect(page.getByText("Limited Use requirements", { exact: false })).toBeVisible();
    await expect(page.getByText("gmail.modify", { exact: false }).first()).toBeVisible();
    await shot(page, "02-privacy-policy");
    await page.goto("/terms");
    await expect(page.getByRole("heading", { name: "Terms of Service" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("shows sign-in errors honestly and 404s unknown pages", async ({ page }) => {
    await page.goto("/?error=access_denied");
    await expect(page.getByRole("alert")).toContainText("cancelled Google sign-in");
    await page.goto("/does-not-exist");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("protected app routes redirect signed-out users to the landing page", async ({ page }) => {
    await page.goto("/app/inbox");
    await expect(page).toHaveURL(/\/\?next=%2Fapp%2Finbox/);
    await expect(page.getByRole("link", { name: "Sign in with Google" }).first()).toHaveAttribute("href", /next=%2Fapp%2Finbox/);
  });
});
