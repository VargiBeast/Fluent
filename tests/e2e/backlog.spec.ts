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

test("templates: create one in Settings and insert it in the composer with ⌘/Ctrl+;", async () => {
  await page.goto("/app/settings/templates");
  await page.getByRole("button", { name: "New template" }).click();
  const dialog = page.getByRole("dialog", { name: "New template" });
  await dialog.getByLabel("Name").fill("Meeting times");
  await dialog.getByLabel("Subject (optional)").fill("Times for next week");
  await dialog.getByLabel("Text").fill("Hi,\n\nI'm free Tuesday 10:00 or Thursday 14:00. Does either work?");
  await dialog.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByRole("list", { name: "Templates" }).getByText("Meeting times")).toBeVisible();

  await page.goto("/app/inbox");
  await page.getByRole("button", { name: "Compose" }).click();
  const composer = page.getByRole("dialog", { name: "New message" });
  await composer.getByRole("textbox", { name: "Message body" }).click();
  await page.keyboard.press("ControlOrMeta+;");
  const picker = page.getByRole("dialog", { name: "Insert a template" });
  await expect(picker).toBeVisible();
  await picker.getByPlaceholder("Search templates…").fill("meet");
  await shot(page, "30-template-picker");
  await page.keyboard.press("Enter");
  await expect(picker).toBeHidden();
  await expect(composer.getByRole("textbox", { name: "Message body" })).toContainText("Thursday 14:00");
  await expect(composer.getByLabel("Subject")).toHaveValue("Times for next week");
  // Menu path works too.
  await composer.getByRole("button", { name: /Insert template/ }).click();
  await expect(page.getByRole("dialog", { name: "Insert a template" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(composer).toBeVisible(); // Escape closed only the picker
  await composer.getByRole("button", { name: "Discard draft" }).click();
  await page.getByRole("dialog", { name: "Discard this draft?" }).getByRole("button", { name: "Discard" }).click();
});

test("signatures: edit the Gmail sender name and signature", async () => {
  await page.goto("/app/settings/signatures");
  const name = page.getByLabel("Sender name");
  await expect(name).toHaveValue(/Alex/);
  await name.fill("Alex M.");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("Saved to Gmail").first()).toBeVisible();
  await page.getByRole("button", { name: "Add signature" }).click();
  const editor = page.getByRole("textbox", { name: "Signature" });
  await editor.click();
  await page.keyboard.type("Alex M. — Product, Northwind");
  await page.getByRole("button", { name: "Save signature" }).click();
  const preview = page.frameLocator('iframe[title^="Signature for"]');
  await expect(preview.getByText("Alex M. — Product, Northwind")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Sender name")).toHaveValue("Alex M.");
  await expect(page.frameLocator('iframe[title^="Signature for"]').getByText("Product, Northwind")).toBeVisible();
  await shot(page, "31-signatures");
});

test("inbox stats: volume, top senders and response time from Gmail", async () => {
  await page.getByRole("link", { name: "Inbox stats" }).click();
  await expect(page.getByRole("heading", { name: "Inbox stats" })).toBeVisible();
  await expect(page.getByText("Received", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Email volume per day" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Top senders" }).getByRole("listitem").first()).toBeVisible();
  await page.getByRole("radio", { name: "90 days" }).click();
  await expect(page.getByRole("heading", { name: "Email volume per week" })).toBeVisible();
  await page.getByRole("radio", { name: "30 days" }).click();
  await expect(page.getByRole("heading", { name: "Email volume per day" })).toBeVisible();
  await shot(page, "32-inbox-stats");
});

test("read later: save from the reader with b, see it in the Read later view, remove it", async () => {
  await page.goto("/app/inbox");
  await page.locator('[data-thread-id="t-canary"]').click();
  await expect(page.getByRole("article", { name: /Q4 design review/ })).toBeVisible();
  await page.keyboard.press("b");
  await expect(page.getByText("Saved to Read later")).toBeVisible();
  await expect(page.getByRole("button", { name: /Remove from Read later/ })).toBeVisible();

  await page.getByRole("link", { name: "Read later" }).click();
  await expect(page.getByRole("heading", { name: "Read later" })).toBeVisible();
  await expect(page.locator('[data-thread-id="t-canary"]')).toBeVisible();
  await expect(page.locator('[data-thread-id="t-invoice"]')).toHaveCount(0);
  await shot(page, "33-read-later");

  await page.locator('[data-thread-id="t-canary"]').click();
  await page.getByRole("button", { name: /Remove from Read later/ }).click();
  await expect(page.getByText("Removed from Read later")).toBeVisible();
  await expect(page.locator('[data-thread-id="t-canary"]')).toHaveCount(0);
});
