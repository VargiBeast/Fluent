import { expect, test, type Page } from "@playwright/test";
import { shot, signIn, trackErrors } from "./helpers";

test.describe.configure({ mode: "serial" });

let page: Page;
let errors: string[];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  errors = trackErrors(page);
  await signIn(page);
});
test.afterAll(async () => {
  expect(errors).toEqual([]);
  await page.close();
});

test("themes: light theme with a teal accent is saved per user and survives a reload", async () => {
  await page.goto("/app/settings/appearance");
  await page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Light" }).click();
  await page.getByRole("radiogroup", { name: "Accent colour" }).getByRole("radio", { name: "Teal" }).click();
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-accent", "teal");
  await expect(html).not.toHaveClass(/dark/);
  await page.reload();
  await expect(html).toHaveAttribute("data-accent", "teal");
  await expect(page.getByRole("radio", { name: "Teal" })).toHaveAttribute("aria-checked", "true");
  await shot(page, "37-theme-light-teal");
  // Back to the defaults so later specs see FLUENT's usual look.
  await page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Dark" }).click();
  await page.getByRole("radio", { name: "Purple" }).click();
  await expect(html).not.toHaveAttribute("data-accent", /.+/);
  await expect(html).toHaveClass(/dark/);
});

test("focus mode: only important mail for 30 minutes, with a banner to exit early", async () => {
  await page.goto("/app/inbox");
  await expect(page.locator("[data-thread-id]").first()).toBeVisible();
  await page.getByRole("button", { name: /Focus mode/ }).click();
  await page.getByRole("menuitem", { name: "For 30 minutes" }).click();
  const banner = page.getByRole("region", { name: "Focus mode" });
  await expect(banner).toContainText("Only important mail");
  await expect(banner).toContainText(/until \d{2}:\d{2}/);
  await expect(page.locator('[data-thread-id="t-canary"]')).toBeVisible();
  const rows = page.locator("[data-thread-id]");
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) await expect(rows.nth(i).locator('[aria-label="Important"]')).toHaveCount(1);
  await page.reload();
  await expect(banner).toBeVisible();
  await shot(page, "38-focus-mode");
  await banner.getByRole("button", { name: "Exit focus mode" }).click();
  await expect(banner).toBeHidden();
  await expect.poll(() => rows.count()).toBeGreaterThan(n);
});
