import { expect, test, type Page } from "@playwright/test";
import { e2eState, shot, signIn, trackErrors } from "./helpers";

test.describe.configure({ mode: "serial" });

let page: Page;
let errors: string[];

/** A scripted stand-in for the browser's speech recogniser: each start() "hears" the next queued phrase. */
const FAKE_SPEECH = () => {
  const w = window as unknown as { __speech: string[]; webkitSpeechRecognition: unknown; SpeechRecognition?: unknown };
  w.__speech = [];
  class FakeRecognition {
    lang = "en-US"; continuous = false; interimResults = false; maxAlternatives = 1;
    onresult: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; onend: (() => void) | null = null;
    start() {
      const text = w.__speech.shift() ?? "";
      const words = text.split(" ");
      setTimeout(() => this.onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: false, length: 1, 0: { transcript: words.slice(0, 2).join(" ") } } } }), 30);
      setTimeout(() => {
        this.onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: text } } } });
        this.onend?.();
      }, 120);
    }
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
  }
  delete w.SpeechRecognition;
  w.webkitSpeechRecognition = FakeRecognition;
};
const say = (p: Page, text: string) => p.evaluate((t) => (window as unknown as { __speech: string[] }).__speech.push(t), text);

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(FAKE_SPEECH);
  errors = trackErrors(page);
  await signIn(page);
});
test.afterAll(async () => {
  expect(errors).toEqual([]);
  await page.close();
});

test("private notes: add a note to a conversation with n, see it after reload, edit and delete it", async () => {
  await page.goto("/app/inbox");
  await page.locator('[data-thread-id="t-canary"]').click();
  await expect(page.getByRole("article", { name: /Q4 design review/ })).toBeVisible();
  await page.keyboard.press("n");
  const note = page.getByRole("region", { name: "Private note" });
  await note.getByRole("textbox", { name: "Private note" }).fill("Bring the metrics deck. Ask Sofia about the budget.");
  await note.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Note saved")).toBeVisible();
  await expect(note.getByText("Only you can see this")).toBeVisible();
  await shot(page, "34-private-note");
  await page.reload();
  await expect(page.getByRole("region", { name: "Private note" }).getByText("Bring the metrics deck.")).toBeVisible();
  await page.getByRole("button", { name: "Edit note" }).click();
  await page.getByRole("textbox", { name: "Private note" }).fill("Deck sent.");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("region", { name: "Private note" }).getByText("Deck sent.")).toBeVisible();
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(page.getByText("Note deleted")).toBeVisible();
  await expect(page.getByRole("region", { name: "Private note" })).toHaveCount(0);
});

test("unsubscribe assistant: senders ranked by open rate, one-click unsubscribe, mailto confirm, archive all with undo", async () => {
  const before = await e2eState(page);
  await page.getByRole("link", { name: "Unsubscribe" }).click();
  await expect(page.getByRole("heading", { name: "Unsubscribe" })).toBeVisible();
  const list = page.getByRole("list", { name: "Newsletter senders" });
  // Ranking by open rate is covered by the integration tests; earlier specs here read/archive some of these.
  for (const sender of ["notify@circles.example", "hello@designweekly.example", "digest@forum.example", "promo@suspicious.example"]) {
    await expect(list.locator(`[data-sender="${sender}"]`)).toContainText(/Opened \d+ of \d+/);
  }
  await expect(list.locator('[data-sender="promo@suspicious.example"]').getByRole("link", { name: /Open unsubscribe page/ })).toHaveAttribute("rel", /noopener/);
  await shot(page, "35-unsubscribe");

  await list.getByRole("button", { name: "Unsubscribe from Lena from Circles" }).click();
  await expect(page.getByText("Unsubscribed from Lena from Circles")).toBeVisible();
  await expect(list.locator('[data-sender="notify@circles.example"]')).toContainText("Unsubscribed");
  await expect(list.getByRole("listitem").last()).toHaveAttribute("data-sender", "notify@circles.example");

  // Mailto needs a confirm that shows exactly what will be sent; cancelling sends nothing.
  await list.getByRole("button", { name: "Unsubscribe from Dev Forum by email" }).click();
  const dialog = page.getByRole("dialog", { name: "Send an unsubscribe email?" });
  await expect(dialog).toContainText("leave@forum.example");
  await expect(dialog).toContainText("Unsubscribe me");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect((await e2eState(page)).sent).toBe(before.sent);

  await list.getByRole("checkbox", { name: "Select Design Weekly" }).check();
  await page.getByRole("button", { name: /Archive all from 1 sender/ }).click();
  await page.getByRole("dialog", { name: /Archive all from Design Weekly/ }).getByRole("button", { name: "Archive all" }).click();
  await expect(page.getByText("Archived 1 email")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Moved 1 back to the Inbox")).toBeVisible();
  await page.goto("/app/inbox");
  await expect(page.locator('[data-thread-id="t-news"]')).toBeVisible();
});

test("voice: dictate into the composer, and a spoken reply command only creates a draft", async () => {
  await page.goto("/app/inbox");
  await page.getByRole("button", { name: "Compose" }).click();
  const composer = page.getByRole("dialog", { name: "New message" });
  await say(page, "see you on Thursday");
  await composer.getByRole("button", { name: /^Dictate/ }).click();
  await expect(composer.getByRole("textbox", { name: "Message body" })).toContainText("see you on Thursday");
  await composer.getByRole("button", { name: "Discard draft" }).click();
  await page.getByRole("dialog", { name: "Discard this draft?" }).getByRole("button", { name: "Discard" }).click();

  const before = await e2eState(page);
  await page.locator('[data-thread-id="t-canary"]').click();
  await page.getByRole("button", { name: "Ask Copilot" }).click();
  const panel = page.getByRole("dialog", { name: "FLUENT Copilot" });
  await say(page, "reply to Sofia that I'll come at 3");
  await panel.getByRole("button", { name: /^Speak to Copilot/ }).click();
  const reply = page.getByRole("dialog", { name: "Reply" });
  await expect(reply).toBeVisible();
  await expect(reply.getByRole("textbox", { name: "Message body" })).toContainText("Hi Sofia,");
  await expect(reply.getByRole("textbox", { name: "Message body" })).toContainText("I'll come at 3.");
  await expect(reply.getByText("won't be sent unless you press Send")).toBeVisible();
  await expect(page.getByText("Draft saved to Gmail")).toBeVisible();
  await shot(page, "36-voice-draft");
  expect((await e2eState(page)).sent).toBe(before.sent);
  // The toasts sit over the composer's bottom bar on this viewport; close them first.
  const closeToast = page.getByRole("button", { name: "Close toast" });
  for (let i = 0; i < 5 && (await closeToast.count()); i++) await closeToast.first().click({ timeout: 2000 }).catch(() => undefined);
  await reply.getByRole("button", { name: "Discard draft" }).click();
  await page.getByRole("dialog", { name: "Discard this draft?" }).getByRole("button", { name: "Discard" }).click();

  // Plain dictation in Copilot just fills the input.
  await page.getByRole("button", { name: "Ask Copilot" }).click();
  await say(page, "archive all newsletters from last week");
  await panel.getByRole("button", { name: /^Speak to Copilot/ }).click();
  await expect(panel.getByRole("textbox", { name: "Ask or instruct Copilot" })).toHaveValue("archive all newsletters from last week");
  await page.keyboard.press("Escape");
});

test("voice: explains itself where the browser has no speech recognition", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 1440, height: 900 } });
  const p2 = await ctx.newPage();
  await p2.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.SpeechRecognition;
    delete w.webkitSpeechRecognition;
    Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined });
  });
  await p2.goto("/app/inbox");
  await p2.getByRole("button", { name: "Compose" }).click();
  await p2.getByRole("dialog", { name: "New message" }).getByRole("button", { name: /not supported in this browser/ }).click();
  await expect(p2.getByText("Voice dictation isn't available in this browser")).toBeVisible();
  await ctx.close();
});
