import { expect, type Page } from "@playwright/test";

/** Shared helpers for MailIQ Playwright e2e. */

export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

export async function shot(page: Page, name: string) {
  await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: false });
}

export async function e2eState(page: Page) {
  return page.evaluate(async () => {
    const r = await fetch("/__e2e/state");
    return r.json() as Promise<{ sent: number; aiRequests: unknown[] }>;
  });
}

export async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: /Sign in with Google/i }).click();
  // Fake Google redirects back into the app and completes onboarding.
  await expect(page.getByRole("heading", { name: /Welcome to MailIQ/ })).toBeVisible();
  const continueBtn = page.getByRole("button", { name: /Continue|Get started|Next/i });
  if (await continueBtn.count()) {
    while (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click();
      await page.waitForTimeout(200);
    }
  }
  await expect(page).toHaveURL(/\/app/);
}
