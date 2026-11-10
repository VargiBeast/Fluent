import { expect, test } from "@playwright/test";
import { shot, signIn, trackErrors } from "./helpers";

test.describe.configure({ mode: "serial" });

test("mobile: landing, inbox, reader, navigation drawer, overview and privacy", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign in with Google" }).first()).toBeVisible();
  await shot(page, "09-mobile-landing");

  await signIn(page);
  await expect(page.locator('[data-thread-id="t-canary"]')).toBeVisible();
  // single-pane layout: no reader placeholder next to the list
  await expect(page.getByText("Select a conversation")).toBeHidden();
  await shot(page, "10-mobile-inbox");

  await page.locator('[data-thread-id="t-canary"]').click();
  await expect(page.getByRole("article", { name: /Q4 design review/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "Conversations" })).toBeHidden();
  await shot(page, "11-mobile-reader");
  await page.getByRole("button", { name: "Back to list" }).first().click();
  await expect(page.getByRole("list", { name: "Conversations" })).toBeVisible();

  await page.getByRole("button", { name: "Open navigation" }).first().click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await expect(drawer).toBeVisible();
  await shot(page, "12-mobile-drawer");
  await drawer.getByRole("link", { name: /AI Overview/ }).click();
  await expect(page.getByRole("heading", { name: "AI Overview" })).toBeVisible();
  await expect(drawer).toBeHidden();
  await shot(page, "13-mobile-overview");

  await page.goto("/app/settings");
  await page.getByRole("link", { name: "Privacy" }).click();
  await expect(page.getByRole("heading", { name: "Privacy", level: 1 })).toBeVisible();
  await shot(page, "14-mobile-privacy");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
