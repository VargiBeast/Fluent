import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, startHarness, TEST_DB_URL, type Harness } from "./harness.js";
import { buildRaw } from "../fakes/seed.js";

let h: Harness;
let c: Client;
let accountId: string;
const ME = "alex@fluent.test";

interface Sender { accountId: string; email: string; name: string; total: number; read: number; unread: number; openRate: number; inInbox: number; messageId: string; methods: { oneClick: boolean; mailto: { address: string; subject: string } | null; link: string | null } }
interface Scan { senders: Sender[]; sample: { messages: number; truncated: boolean }; errors: unknown[] }

beforeAll(async () => {
  h = await startHarness();
  c = new Client(h);
  await c.login();
  accountId = (await c.json<{ accounts: Array<{ id: string }> }>("/api/auth/session")).body.accounts[0]!.id;
});
afterAll(async () => { await h.close(); });
// Scans are rate limited (10/min); start each test with a fresh window.
beforeEach(async () => {
  const sql = postgres(TEST_DB_URL, { onnotice: () => {} });
  await sql`DELETE FROM rate_limits`;
  await sql.end();
});

const scan = (cl: Client = c, q = "") => cl.json<Scan>(`/api/newsletters/senders${q}`);
const act = (body: Record<string, unknown>, cl: Client = c) => cl.json<{ ok: boolean; sender: string }>("/api/newsletters/unsubscribe", { method: "POST", body: JSON.stringify(body) });
const deliverNewsletter = (from: string, list: string, unread: boolean) => {
  const id = h.google.state.gmail.deliver(ME, buildRaw({
    from, to: ME, subject: `Issue ${Math.random()}`, text: "news", date: new Date(), messageId: `<${Math.random()}@x>`,
    headers: [`List-Unsubscribe: <${h.google.url}/__unsub/${list}>`, "List-Unsubscribe-Post: List-Unsubscribe=One-Click"],
  }));
  if (!unread) h.google.mailbox(ME).messages.get(id)!.labelIds.delete("UNREAD");
  return id;
};

describe("Unsubscribe assistant", () => {
  it("lists newsletter senders from List-Unsubscribe headers, least-opened first", async () => {
    deliverNewsletter("Shop Deals <deals@shop.example>", "shop", true);
    deliverNewsletter("Shop Deals <deals@shop.example>", "shop", true);
    deliverNewsletter("Shop Deals <deals@shop.example>", "shop", false);
    const r = await scan();
    expect(r.status).toBe(200);
    const emails = r.body.senders.map((s) => s.email);
    // Never opened, then 1 of 3 opened, then always opened (newest first).
    expect(emails).toEqual(["notify@circles.example", "deals@shop.example", "hello@designweekly.example", "promo@suspicious.example", "digest@forum.example"]);
    expect(emails).not.toContain("deals@promo.example"); // in Trash
    expect(emails).not.toContain("sofia@northwind.example"); // not a newsletter
    const shop = r.body.senders[1]!;
    expect(shop).toMatchObject({ name: "Shop Deals", total: 3, read: 1, unread: 2, inInbox: 3, methods: { oneClick: true, mailto: null, link: null } });
    expect(shop.openRate).toBeCloseTo(1 / 3);
    const dw = r.body.senders.find((s) => s.email === "hello@designweekly.example")!;
    expect(dw.methods).toEqual({ oneClick: true, mailto: { address: "leave@designweekly.example", subject: "unsubscribe" }, link: null });
    expect(r.body.senders.find((s) => s.email === "digest@forum.example")!.methods).toEqual({ oneClick: false, mailto: { address: "leave@forum.example", subject: "Unsubscribe me" }, link: null });
    expect(r.body.senders.find((s) => s.email === "promo@suspicious.example")!.methods).toEqual({ oneClick: false, mailto: null, link: "https://suspicious.example/unsub?u=1" });
    // Scanning changes nothing in Gmail.
    expect(h.google.state.unsubscribes).toEqual([]);
    expect(h.google.mailbox(ME).sent).toEqual([]);
  });

  it("one-click unsubscribes with an RFC 8058 POST only after an explicit confirm", async () => {
    const shop = (await scan()).body.senders.find((s) => s.email === "deals@shop.example")!;
    expect((await act({ accountId, messageId: shop.messageId, method: "one-click" })).status).toBe(400);
    expect(h.google.state.unsubscribes).toEqual([]);
    const r = await act({ accountId, messageId: shop.messageId, method: "one-click", confirm: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, sender: "deals@shop.example" });
    expect(h.google.state.unsubscribes).toEqual([{ list: "shop", body: "List-Unsubscribe=One-Click", contentType: "application/x-www-form-urlencoded" }]);
    expect(h.google.mailbox(ME).sent).toEqual([]);
  });

  it("reports a failing unsubscribe service and refuses methods the sender doesn't offer", async () => {
    const id = deliverNewsletter("Broken <news@broken.example>", "broken", true);
    expect((await act({ accountId, messageId: id, method: "one-click", confirm: true })).status).toBe(502);
    const forum = (await scan()).body.senders.find((s) => s.email === "digest@forum.example")!;
    expect((await act({ accountId, messageId: forum.messageId, method: "one-click", confirm: true })).status).toBe(400);
    const sus = (await scan()).body.senders.find((s) => s.email === "promo@suspicious.example")!;
    expect((await act({ accountId, messageId: sus.messageId, method: "mailto", confirm: true })).status).toBe(400);
  });

  it("refuses one-click URLs that point at internal addresses", async () => {
    const id = h.google.state.gmail.deliver(ME, buildRaw({
      from: "Evil <x@evil.example>", to: ME, subject: "x", text: "x", date: new Date(), messageId: "<evil@x>",
      headers: ["List-Unsubscribe: <https://169.254.169.254/latest/meta-data>", "List-Unsubscribe-Post: List-Unsubscribe=One-Click"],
    }));
    const r = await act({ accountId, messageId: id, method: "one-click", confirm: true });
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).toMatch(/isn't allowed/);
  });

  it("mailto unsubscribe sends one email from the user's account after confirm", async () => {
    const forum = (await scan()).body.senders.find((s) => s.email === "digest@forum.example")!;
    const r = await act({ accountId, messageId: forum.messageId, method: "mailto", confirm: true });
    expect(r.status).toBe(200);
    const sent = h.google.mailbox(ME).sent;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^To: leave@forum\.example$/m);
    expect(sent[0]).toMatch(/^Subject: Unsubscribe me$/m);
    expect(sent[0]).toMatch(/^From: .*alex@fluent\.test/m);
    expect(sent[0]).not.toMatch(/^(Cc|Bcc):/m);
  });

  it("archives everything from chosen senders and can undo it", async () => {
    const box = h.google.mailbox(ME);
    const inbox = (email: string) => [...box.messages.values()].filter((m) => m.labelIds.has("INBOX") && JSON.stringify(m.payload.headers).includes(email)).length;
    expect(inbox("deals@shop.example")).toBe(3);
    const body = { senders: [{ accountId, email: "deals@shop.example" }, { accountId, email: "hello@designweekly.example" }] };
    expect((await c.json("/api/newsletters/archive", { method: "POST", body: JSON.stringify(body) })).status).toBe(400); // no confirm
    expect(inbox("deals@shop.example")).toBe(3);
    const r = await c.json<{ archived: number; undo: Array<{ accountId: string; messageIds: string[] }> }>("/api/newsletters/archive", { method: "POST", body: JSON.stringify({ ...body, confirm: true }) });
    expect(r.status).toBe(200);
    expect(r.body.archived).toBe(4);
    expect(inbox("deals@shop.example")).toBe(0);
    expect(inbox("hello@designweekly.example")).toBe(0);
    expect(inbox("sofia@northwind.example")).toBe(1); // untouched
    const u = await c.json<{ restored: number }>("/api/newsletters/archive/undo", { method: "POST", body: JSON.stringify({ items: r.body.undo }) });
    expect(u.body.restored).toBe(4);
    expect(inbox("deals@shop.example")).toBe(3);
  });

  it("validates input", async () => {
    expect((await scan(c, "?days=7")).status).toBe(400);
    expect((await scan(c, "?days=30&x=1")).status).toBe(400);
    expect((await act({ accountId, messageId: "bad id!", method: "one-click", confirm: true })).status).toBe(400);
    expect((await act({ accountId, messageId: "abc", method: "link", confirm: true })).status).toBe(400);
    expect((await c.json("/api/newsletters/archive", { method: "POST", body: JSON.stringify({ senders: [{ accountId, email: "a@b.example OR in:anywhere" }], confirm: true }) })).status).toBe(400);
    expect((await new Client(h).json("/api/newsletters/senders")).status).toBe(401);
  });

  it("isolates users", async () => {
    await fetch(`${h.google.url}/__control/identity`, { method: "POST", body: JSON.stringify({ sub: "8118", email: "trent@fluent.test", name: "Trent" }) });
    const other = new Client(h);
    await other.login();
    await fetch(`${h.google.url}/__control/reset`, { method: "POST" });
    const theirs = await scan(other);
    expect(theirs.body.senders.every((s) => s.accountId !== accountId)).toBe(true);
    expect(theirs.body.senders.map((s) => s.email)).not.toContain("deals@shop.example");
    const dw = (await scan()).body.senders.find((s) => s.email === "hello@designweekly.example")!;
    const before = h.google.state.unsubscribes.length;
    expect((await act({ accountId, messageId: dw.messageId, method: "one-click", confirm: true }, other)).status).toBe(404);
    expect(h.google.state.unsubscribes.length).toBe(before);
    expect((await other.json("/api/newsletters/archive", { method: "POST", body: JSON.stringify({ senders: [{ accountId, email: "notify@circles.example" }], confirm: true }) })).status).toBe(404);
    expect((await other.json("/api/newsletters/archive/undo", { method: "POST", body: JSON.stringify({ items: [{ accountId, messageIds: ["abc"] }] }) })).status).toBe(404);
  });
});
