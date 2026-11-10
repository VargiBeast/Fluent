import { expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SHOTS = process.env.SHOTS_DIR ?? "test-results/screenshots";
mkdirSync(SHOTS, { recursive: true });

export async function shot(page: Page, name: string) {
  await page.waitForTimeout(350); // let animations settle
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** Sign in through the fake Google OAuth server and finish onboarding if shown. */
export async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in with Google" }).first().click();
  await page.waitForURL(/\/app\//);
  if (page.url().includes("/app/onboarding")) {
    await expect(page.getByRole("heading", { name: /Welcome to FLUENT/ })).toBeVisible();
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Open my inbox" }).click();
  }
  await page.waitForURL(/\/app\/inbox/);
  await expect(page.getByRole("list", { name: "Conversations" })).toBeVisible();
}

export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    // Playwright's screenshot helpers try to run in every frame; the sandboxed email iframe (no allow-scripts)
    // correctly refuses. That refusal is expected and proves the sandbox works.
    if (/Blocked script execution in 'about:srcdoc'/.test(m.text())) return;
    if (m.type() === "error" && !/Failed to load resource: the server responded with a status of (401|403|404)/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

export async function e2eState(page: Page): Promise<{ sent: number; aiRequests: number }> {
  return (await page.request.get("/__e2e/state")).json();
}
