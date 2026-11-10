import { expect, test, type Page } from "@playwright/test";
import { e2eState, shot, signIn, trackErrors } from "./helpers";

test.describe.configure({ mode: "serial" });

let page: Page;
let errors: string[];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  errors = trackErrors(page);
});
test.afterAll(async () => {
  await page.close();
});

test("signs in with Google (PKCE), completes onboarding and lands in the unified inbox", async () => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: /Inbox/ })).toBeVisible();
  await expect(page.locator('[data-thread-id="t-canary"]')).toBeVisible();
  // Trash and spam never show in the inbox
  await expect(page.locator('[data-thread-id="t-trash"]')).toHaveCount(0);
  await shot(page, "03-inbox-desktop");
});

test("reads a conversation with an AI summary, sanitised HTML and blocked trackers", async () => {
  await page.locator('[data-thread-id="t-canary"]').click();
  await expect(page.getByRole("article", { name: /Q4 design review/ })).toBeVisible();
  await expect(page.getByText("Fake summary of a thread")).toBeVisible();
  const frame = page.frameLocator("iframe").first();
  await expect(frame.getByText("Could you confirm whether")).toBeVisible();
  await shot(page, "04-reader-ai-summary");

  await page.locator('[data-thread-id="t-invoice"]').click();
  await expect(page.getByText(/remote image|tracker/i).first()).toBeVisible();
  const invoice = page.frameLocator("iframe").first();
  await expect(invoice.getByText("Invoice INV-20431")).toBeVisible();
  // No script ran and javascript: links were neutralised
  expect(await invoice.locator("script").count()).toBe(0);
  expect(await invoice.locator('a[href^="javascript:"]').count()).toBe(0);
});

test("AI quick reply requires explicit confirmation before sending", async () => {
  await page.locator('[data-thread-id="t-canary"]').click();
  const before = (await e2eState(page)).sent;
  await page.getByRole("button", { name: "Generate quick reply" }).click();
  const box = page.getByRole("textbox", { name: "Reply text" });
  await expect(box).toHaveValue(/Thursday at 14:00/);
  await page.getByRole("button", { name: "Send reply" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Send AI-written reply?" });
  await expect(dialog).toBeVisible();
  expect((await e2eState(page)).sent).toBe(before); // nothing sent yet
  await dialog.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText(/Reply sent|Sent/).first()).toBeVisible();
  await expect.poll(async () => (await e2eState(page)).sent).toBe(before + 1);
});

test("archives with a keyboard shortcut and syncs to Gmail", async () => {
  await page.locator('[data-thread-id="t-school"]').click();
  await expect(page.getByRole("article", { name: /Parent–teacher/ })).toBeVisible();
  await page.keyboard.press("e");
  await expect(page.locator('[data-thread-id="t-school"]')).toHaveCount(0);
  await page.goto("/app/archive");
  await expect(page.locator('[data-thread-id="t-school"]')).toBeVisible();
});

test("composes a new email with AI help, formatting and confirmation", async () => {
  await page.goto("/app/inbox");
  await page.getByRole("button", { name: "Compose" }).first().click();
  const composer = page.getByRole("dialog", { name: /New message/ }).or(page.getByRole("region", { name: /New message/ }));
  await page.getByLabel("To").first().fill("maya@studio.example");
  await page.getByLabel("To").first().press("Enter");
  await page.locator("#compose-subject").fill("Moodboard follow-up");
  await page.getByRole("button", { name: "Write with AI" }).click();
  await page.locator("#ai-instruction").fill("Thank Maya and ask for the source files");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.locator(".tiptap")).toContainText("Thursday at 14:00");
  await shot(page, "05-composer-ai");
  const before = (await e2eState(page)).sent;
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Send AI-assisted message?" })).toBeVisible();
  await page.getByRole("button", { name: "Yes, send it" }).click();
  await expect.poll(async () => (await e2eState(page)).sent).toBe(before + 1);
  void composer;
});

test("natural-language search turns a request into a visible Gmail query", async () => {
  await page.goto("/app/inbox");
  await page.getByRole("button", { name: "Ask AI" }).click();
  const search = page.getByRole("searchbox", { name: "Natural-language search" }).or(page.getByRole("textbox", { name: "Natural-language search" }));
  await search.fill("Find the invoice I received last month");
  await search.press("Enter");
  await expect(page.getByText(/Gmail query: invoice/)).toBeVisible();
  await expect(page.locator('[data-thread-id="t-invoice"]')).toBeVisible();
  await expect(page.locator('[data-thread-id="t-receipt"]')).toBeVisible();
});

test("AI Overview shows a briefing grounded in real threads", async () => {
  await page.goto("/app/overview");
  await expect(page.getByRole("heading", { name: "AI Overview" })).toBeVisible();
  await expect(page.getByText("Your briefing")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs your reply" })).toBeVisible();
  await shot(page, "06-overview");
});

test("follow-up radar drafts a nudge through the confirm flow", async () => {
  await page.goto("/app/overview");
  const radar = page.getByRole("region", { name: "Follow-up radar" });
  await expect(radar).toBeVisible();
  await radar.getByRole("button", { name: "Draft nudge: Contract draft for the Fjord Labs pilot" }).click();
  const dialog = page.getByRole("dialog", { name: "Review the draft" });
  await expect(dialog.getByText("To: jonas@fjordlabs.example")).toBeVisible();
  await shot(page, "20-radar-nudge");
  await dialog.getByRole("button", { name: /Confirm/ }).click();
  await expect(dialog.getByTestId("plan-result")).toContainText("saved 1 draft");
  await page.keyboard.press("Escape");
});

test("Copilot answers with sources and opens the cited email", async () => {
  await page.getByRole("button", { name: "Ask Copilot" }).click();
  const panel = page.getByRole("dialog", { name: "FLUENT Copilot" });
  await panel.getByRole("textbox", { name: "Ask or instruct Copilot" }).fill("What does the invoice say?");
  await panel.getByRole("button", { name: "Send to Copilot" }).click();
  await expect(panel.getByText("Sources")).toBeVisible();
  await shot(page, "07-copilot");
  await panel.getByRole("button", { name: /invoice|Receipt/i }).first().click();
  await expect(page).toHaveURL(/\/app\/all\//);
});

test("Copilot turns an instruction into a plan, runs it only after Confirm, and can undo (⌘K)", async () => {
  await page.goto("/app/inbox");
  await expect(page.locator('[data-thread-id="t-news"]')).toBeVisible();
  await page.keyboard.press("Control+k");
  const panel = page.getByRole("dialog", { name: "FLUENT Copilot" });
  await expect(panel).toBeVisible();
  await panel.getByRole("textbox", { name: "Ask or instruct Copilot" }).fill("Archive the newsletters");
  await panel.getByRole("button", { name: "Send to Copilot" }).click();
  const card = panel.getByTestId("plan-card");
  await expect(card.getByText("Archive 2 conversations")).toBeVisible();
  await expect(card.getByText("10 interface patterns worth stealing")).toBeVisible();
  // Untick one conversation; nothing has changed yet.
  await card.getByRole("checkbox", { name: "Include Account notice" }).uncheck();
  await expect(page.locator('[data-thread-id="t-news"]')).toBeVisible();
  await shot(page, "15-copilot-plan-preview");
  await card.getByRole("button", { name: /Confirm/ }).click();
  await expect(card.getByTestId("plan-result")).toContainText("archived 1 conversation");
  await expect(page.locator('[data-thread-id="t-news"]')).toHaveCount(0);
  await expect(page.locator('[data-thread-id="t-injection"]')).toBeVisible();
  await shot(page, "16-copilot-result");
  await card.getByRole("button", { name: "Undo" }).click();
  await expect(card.getByText("Undone.")).toBeVisible();
  await expect(page.locator('[data-thread-id="t-news"]')).toBeVisible();

  // Sending: full email shown, extra confirmation, nothing sent until then.
  const before = (await e2eState(page)).sent;
  await panel.getByRole("textbox", { name: "Ask or instruct Copilot" }).fill("Send a reply to sofia saying Thursday works");
  await panel.getByRole("button", { name: "Send to Copilot" }).click();
  const sendCard = panel.getByTestId("plan-card").last();
  await expect(sendCard.getByText("To: sofia@northwind.example")).toBeVisible();
  await expect(sendCard.getByTestId("draft-body")).toContainText("Thursday");
  await sendCard.getByRole("button", { name: /Confirm/ }).click();
  const risk = sendCard.getByRole("alertdialog", { name: "Confirm risky actions" });
  await expect(risk).toContainText("Send 1 email");
  await expect(risk.getByRole("button", { name: "Send 1" })).toBeDisabled();
  await shot(page, "17-copilot-send-confirm");
  expect((await e2eState(page)).sent).toBe(before);
  await risk.getByRole("checkbox").check();
  await risk.getByRole("button", { name: "Send 1" }).click();
  await expect(sendCard.getByTestId("plan-result")).toContainText("sent 1 email");
  expect((await e2eState(page)).sent).toBe(before + 1);
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("privacy dashboard lists AI access by subject and enforces exclusions", async () => {
  await page.goto("/app/settings/privacy");
  const log = page.getByRole("list", { name: "AI access log" });
  await expect(log).toBeVisible();
  await expect(log.getByText("Email summary").first()).toBeVisible();
  await expect(log.getByText("Q4 design review — can you confirm Thursday?").first()).toBeVisible();
  await expect(log).not.toContainText("Could you confirm whether");

  await page.getByLabel("Sender or domain to exclude").fill("@northwind.example");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("list", { name: "Excluded senders" })).toContainText("@northwind.example");
  await shot(page, "08-privacy-dashboard");

  const ai = (await e2eState(page)).aiRequests;
  await page.goto("/app/inbox");
  await page.locator('[data-thread-id="t-canary"]').click();
  await expect(page.getByText(/excluded from AI/i)).toBeVisible();
  expect((await e2eState(page)).aiRequests).toBe(ai);

  await page.goto("/app/settings/privacy");
  await page.getByRole("button", { name: "Remove @northwind.example" }).click();
  await page.getByRole("button", { name: "Clear history" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Clear history" }).click();
  await expect(page.getByText("No AI activity recorded")).toBeVisible();
});

test("shows stored data and exports it as JSON without tokens", async () => {
  await page.goto("/app/settings/data");
  await expect(page.getByRole("list", { name: "Stored data" })).toContainText("Connected Gmail accounts");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download export" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^fluent-export-\d{4}-\d{2}-\d{2}\.json$/);
  const body = await (await download.createReadStream()).toArray();
  const text = Buffer.concat(body).toString("utf8");
  expect(text).toContain("alex@fluent.test");
  expect(text).not.toMatch(/refresh_token|access_token|ya29\./);
});

test("settings: appearance, labels & filters, and sessions work", async () => {
  await page.goto("/app/settings/appearance");
  await page.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.goto("/app/settings/labels");
  await expect(page.getByRole("list", { name: "Labels" })).toContainText("Clients");
  await page.getByRole("button", { name: "New filter" }).click();
  const dialog = page.getByRole("dialog", { name: "New filter" });
  await dialog.getByLabel("From").fill("digest@forum.example");
  await dialog.getByLabel("Mark as read").check();
  await dialog.getByRole("button", { name: "Create filter" }).click();
  await expect(page.getByRole("list", { name: "Filters" })).toContainText("digest@forum.example");

  await page.goto("/app/settings/security");
  await expect(page.getByText("This device")).toBeVisible();
});

test("no uncaught errors during the session", async () => {
  expect(errors).toEqual([]);
});
