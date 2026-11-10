import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, startHarness, TEST_DB_URL, type Harness } from "./harness.js";
import { startFakeMailServers, type FakeMailServers } from "../fakes/mailServers.js";

let h: Harness;
let c: Client;
let mail: FakeMailServers;
let accountId: string;
const sql = postgres(TEST_DB_URL, { onnotice: () => {} });
const PASSWORD = "app-pass-1234";
const input = (over: Record<string, unknown> = {}) => ({
  email: "robin@mail.fluent.test", name: "Robin", password: PASSWORD,
  imap: { host: "imap.mail.fluent.test", port: 993 }, smtp: { host: "smtp.mail.fluent.test", port: 465 }, ...over,
});
const post = (path: string, body: unknown) => c.json<Record<string, unknown>>(path, { method: "POST", body: JSON.stringify(body) });

beforeAll(async () => {
  mail = await startFakeMailServers(PASSWORD);
  process.env.FLUENT_TEST_MAIL_PORTS = `993=${mail.imapPort},465=${mail.smtpPort},587=${mail.smtpPort}`;
  h = await startHarness();
  c = new Client(h);
  await c.login();
});
afterAll(async () => {
  delete process.env.FLUENT_TEST_MAIL_PORTS;
  await sql.end();
  await h.close();
  await mail.close();
});

describe("IMAP/SMTP accounts", () => {
  it("offers presets for iCloud, Yahoo and Fastmail", async () => {
    const r = await c.json<{ imapPresets: Array<{ id: string; imap: { port: number } }> }>("/api/mail-accounts/providers");
    expect(r.body.imapPresets.map((p) => p.id)).toEqual(["icloud", "yahoo", "fastmail"]);
  });

  it("refuses unsafe servers, other ports and wrong passwords", async () => {
    for (const bad of [
      { imap: { host: "127.0.0.1", port: 993 } },
      { imap: { host: "localhost", port: 993 } },
      { imap: { host: "imap.mail.fluent.test", port: 143 } },
      { smtp: { host: "smtp.mail.fluent.test", port: 25 } },
      { imap: { host: "imap.mail.fluent.test:993", port: 993 } },
    ]) expect((await post("/api/mail-accounts/imap", input(bad))).status).toBe(400);
    expect((await post("/api/mail-accounts/imap", input())).status).toBe(429); // 5 attempts a minute
    await sql`delete from rate_limits`;
    const wrong = await post("/api/mail-accounts/imap", input({ password: "nope" }));
    expect(wrong.status).toBe(401);
    expect(JSON.stringify(wrong.body)).not.toContain("nope");
    await sql`delete from rate_limits`;
  });

  it("connects with an app password and stores it encrypted", async () => {
    const r = await post("/api/mail-accounts/imap", input());
    expect(r.status).toBe(200);
    const acc = r.body.account as { id: string; provider: string; capabilities: { categories: boolean } };
    expect(acc).toMatchObject({ provider: "imap", capabilities: { categories: false } });
    accountId = acc.id;
    const [row] = await sql`select credentials_enc, refresh_token_enc from accounts where id = ${accountId}`;
    expect(row!.credentials_enc).toBeTruthy();
    expect(String(row!.credentials_enc)).not.toContain(PASSWORD);
    expect(row!.refresh_token_enc).toBeNull();
    const s = await c.json("/api/auth/session");
    expect(JSON.stringify(s.body)).not.toContain(PASSWORD);
  });

  it("lists, opens, stars and archives mail, next to Gmail in All inboxes", async () => {
    const list = await c.json<{ threads: Array<{ id: string; subject: string; unread: boolean }> }>(`/api/mail/threads?folder=inbox&account=${accountId}`);
    expect(list.status).toBe(200);
    expect(list.body.threads.map((t) => t.subject)).toEqual(["Your receipt", "Lunch on Friday?"]);
    const lunch = list.body.threads[1]!;
    expect(lunch.unread).toBe(true);
    const all = await c.json<{ threads: Array<{ accountId: string }> }>("/api/mail/threads?folder=inbox&account=all");
    expect(new Set(all.body.threads.map((t) => t.accountId)).size).toBe(2);
    const t = await c.json<{ messages: Array<{ bodyText: string; from: { email: string } }> }>(`/api/mail/threads/${accountId}/${lunch.id}`);
    expect(t.body.messages[0]).toMatchObject({ from: { email: "ola@example.org" } });
    expect(t.body.messages[0]!.bodyText).toContain("lunch on Friday");
    expect((await post(`/api/mail/threads/${accountId}/${lunch.id}/action`, { action: "star" })).status).toBe(200);
    expect((await post(`/api/mail/threads/${accountId}/${lunch.id}/action`, { action: "archive" })).status).toBe(200);
    const after = await c.json<{ threads: Array<{ subject: string }> }>(`/api/mail/threads?folder=inbox&account=${accountId}`);
    expect(after.body.threads.map((x) => x.subject)).toEqual(["Your receipt"]);
    const archived = await c.json<{ threads: Array<{ subject: string; starred: boolean }> }>(`/api/mail/threads?folder=archive&account=${accountId}`);
    expect(archived.body.threads).toEqual([expect.objectContaining({ subject: "Lunch on Friday?", starred: true })]);
    // Gmail-only features degrade with a clear error.
    expect((await post(`/api/mail/threads/${accountId}/${lunch.id}/action`, { action: "important" })).status).toBe(400);
  });

  it("saves drafts and sends over SMTP with Bcc only in the envelope", async () => {
    const d = await post("/api/compose/drafts", { accountId, to: ["Ola <ola@example.org>"], subject: "Re: Lunch", text: "Friday works.", html: "<p>Friday works.</p>" });
    expect(d.status).toBe(200);
    const draftId = d.body.draftId as string;
    const got = await c.json<{ subject: string; to: Array<{ email: string }> }>(`/api/compose/drafts/${accountId}/${draftId}`);
    expect(got.body).toMatchObject({ subject: "Re: Lunch", to: [{ email: "ola@example.org" }] });
    const s = await post("/api/compose/send", { accountId, draftId, to: ["Ola <ola@example.org>"], bcc: ["boss@example.org"], subject: "Re: Lunch", text: "Friday works.", html: "<p>Friday works.</p>" });
    expect(s.status).toBe(200);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.to.sort()).toEqual(["boss@example.org", "ola@example.org"]);
    expect(mail.sent[0]!.raw).not.toMatch(/^Bcc:/im);
    expect(mail.sent[0]!.raw).toMatch(/^From: "?Robin"? <robin@mail.fluent.test>/m);
    const sentBox = await c.json<{ threads: Array<{ subject: string }> }>(`/api/mail/threads?folder=sent&account=${accountId}`);
    expect(sentBox.body.threads.map((x) => x.subject)).toEqual(["Re: Lunch"]);
    const drafts = await c.json<{ drafts: unknown[] }>(`/api/mail/drafts?account=${accountId}`);
    expect(drafts.body.drafts).toEqual([]);
  });

  it("keeps IMAP accounts private to their owner", async () => {
    await fetch(`${h.google.url}/__control/identity`, { method: "POST", body: JSON.stringify({ sub: "7119", email: "gus@fluent.test", name: "Gus" }) });
    const other = new Client(h);
    await other.login();
    await fetch(`${h.google.url}/__control/reset`, { method: "POST" });
    expect((await other.json(`/api/mail/threads?folder=inbox&account=${accountId}`)).status).toBe(404);
  });
});
