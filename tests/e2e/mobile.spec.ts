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
  // Installed iPhone: the drawer's solid background runs edge to edge behind the status bar and home indicator.
  await page.evaluate(() => { document.documentElement.style.setProperty("--sat", "47px"); document.documentElement.style.setProperty("--sab", "34px"); });
  const vh = page.viewportSize()!.height;
  await expect.poll(async () => Math.round((await drawer.boundingBox())!.y)).toBe(0); // after the open animation
  const box = (await drawer.boundingBox())!;
  expect(Math.round(box.height)).toBe(vh);
  const styles = await drawer.evaluate((el) => { const c = getComputedStyle(el); return [c.paddingTop, c.paddingBottom, c.backgroundColor]; });
  expect(styles.slice(0, 2)).toEqual(["47px", "34px"]);
  expect(styles[2]).not.toMatch(/rgba\(.*, 0(\.\d+)?\)$/); // opaque
  const overlay = page.locator("[data-drawer-overlay]");
  expect(await overlay.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe("none");
  expect(Math.round((await overlay.boundingBox())!.height)).toBe(vh);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById("root")!).paddingTop)).toBe("47px");
  await shot(page, "12-mobile-drawer");
  await page.evaluate(() => { document.documentElement.style.removeProperty("--sat"); document.documentElement.style.removeProperty("--sab"); });
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

test("mobile: long-press selects, bottom action bar marks unread", async ({ page }) => {
  await signIn(page);
  const row = page.locator('[data-thread-id="t-landlord"]');
  await row.scrollIntoViewIfNeeded();
  const box = (await row.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const pt = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt] });
  await page.waitForTimeout(650);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const bar = page.getByRole("toolbar", { name: /Bulk actions/ });
  await expect(bar).toContainText("1 selected");
  await expect(page.locator("[data-fab]")).toBeHidden(); // the bar owns the bottom edge
  await expect(page).toHaveURL(/\/app\/inbox$/); // long-press didn't open the conversation
  await shot(page, "27-mobile-bulk-bar");
  await bar.getByRole("button", { name: "Mark unread" }).click();
  await expect(page.getByText("Marked as unread 1 conversation")).toBeVisible();
});

test("mobile: swipe left to reply shows three AI suggestions as an editable draft", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page);
  const row = page.locator('[data-thread-id="t-canary"]');
  const box = (await row.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width - 30;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 - i * 18, y }] });
  }
  await expect(page.getByText("Reply", { exact: true }).first()).toBeVisible();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  await expect(page.getByRole("article", { name: /Q4 design review/ })).toBeVisible();
  await expect(page).not.toHaveURL(/reply=1/); // one-shot: a reload doesn't re-trigger
  const list = page.getByTestId("reply-suggestions");
  await expect(list.getByRole("button")).toHaveCount(3);
  const reply = page.getByRole("textbox", { name: "Reply text" });
  await expect(reply).toBeFocused();
  await expect(reply).toHaveValue("");  // nothing is pre-filled or sent until the user picks
  await list.getByRole("button", { name: /Suggest Friday/ }).click();
  await expect(reply).toHaveValue(/Friday at 10:00/);
  await expect(page.getByText("Written with AI")).toBeVisible();
  await reply.fill("Thursday is tricky for me. Would Friday at 11:00 work instead?");
  await shot(page, "29-mobile-swipe-reply");
  await page.getByRole("button", { name: "Send reply" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Send AI-written reply?" }).or(page.getByRole("dialog", { name: "Send AI-written reply?" }));
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Send reply" }).click();
  await expect(reply).toHaveValue("");
  expect(errors).toEqual([]);
});

test("mobile: Copilot plans an action, confirms it and shows the result", async ({ page }) => {
  const errors = trackErrors(page);
  await signIn(page);
  await expect(page.getByRole("button", { name: "Compose" })).toBeVisible(); // the one floating button
  await page.getByRole("button", { name: "Ask with Copilot" }).click(); // in the search pill
  const panel = page.getByRole("dialog", { name: "FLUENT Copilot" });
  await expect(panel).toBeVisible();
  await panel.getByRole("textbox", { name: "Ask or instruct Copilot" }).fill("Star everything from riverside");
  await panel.getByRole("button", { name: "Send to Copilot" }).click();
  const card = panel.getByTestId("plan-card");
  await expect(card.getByText("Star 1 conversation")).toBeVisible();
  await expect(card.getByText(/Parent–teacher conference/)).toBeVisible();
  await shot(page, "18-mobile-copilot-plan");
  await card.getByRole("button", { name: /Confirm/ }).click();
  await expect(card.getByTestId("plan-result")).toContainText("starred 1 conversation");
  await shot(page, "19-mobile-copilot-result");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
