import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, startHarness, TEST_DB_URL, type Harness } from "./harness.js";
import { startFakeMicrosoft, type FakeMicrosoft } from "../fakes/microsoft.js";
import { resetEnv } from "../../server/env.js";

let h: Harness;
let ms: FakeMicrosoft;
let c: Client;
let accountId: string;
const sql = postgres(TEST_DB_URL, { onnotice: () => {} });
const post = (path: string, body: unknown) => c.json<Record<string, unknown>>(path, { method: "POST", body: JSON.stringify(body) });
type List = { threads: Array<{ id: string; accountId: string; subject: string; unread: boolean; starred: boolean; important: boolean; snippet: string }> };
const list = (q: string) => c.json<List>(`/api/mail/threads?${q}&account=${accountId}`);
const mime = (from: string, subject: string, text: string, extra = "") =>
  `From: ${from}\r\nTo: Alex Outlook <alex@outlook.example>\r\nSubject: ${subject}\r\nMessage-ID: <${Math.random().toString(36).slice(2)}@example.org>\r\nDate: ${new Date().toUTCString()}\r\n${extra}MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}\r\n`;

beforeAll(async () => {
  ms = await startFakeMicrosoft();
  h = await startHarness();
  Object.assign(process.env, { MS_CLIENT_ID: ms.state.clientId, MS_CLIENT_SECRET: ms.state.clientSecret, FLUENT_TEST_MS_BASE: ms.url });
  resetEnv();
  c = new Client(h);
  await c.login();
  const start = await c.raw("/api/auth/microsoft/start");
  const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
  const cb = new URL(authorize.headers.get("location")!);
  expect((await c.raw(`${cb.pathname}${cb.search}`)).headers.get("location")).toBe("/app/account?connected=outlook");
  accountId = String((await sql`select id from accounts where provider = 'outlook'`)[0]!.id);
  await ms.addMessage({ folder: "inbox", mime: mime("Ola <ola@example.org>", "Lunch on Friday?", "Want to grab lunch on Friday?"), received: "2026-11-09T10:00:00Z" });
  await ms.addMessage({ folder: "inbox", isRead: true, importance: "high", received: "2026-11-10T09:00:00Z",
    mime: mime("Shop <shop@example.com>", "Your receipt", "Thanks!", "").replace("Content-Type: text/plain; charset=utf-8\r\n\r\nThanks!\r\n",
      'Content-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nThanks!\r\n--b\r\nContent-Type: text/plain; name="r.txt"\r\nContent-Disposition: attachment; filename="r.txt"\r\n\r\nTOTAL 42\r\n--b--\r\n') });
});
afterAll(async () => {
  for (const k of ["MS_CLIENT_ID", "MS_CLIENT_SECRET", "FLUENT_TEST_MS_BASE"]) delete process.env[k];
  resetEnv();
  await sql.end();
  await h.close();
  await ms.close();
});

describe("Outlook / Microsoft 365 over Graph", () => {
  it("lists, searches and opens mail with immutable ids that are safe in URLs", async () => {
    const r = await list("folder=inbox");
    expect(r.status).toBe(200);
    expect(r.body.threads.map((t) => t.subject)).toEqual(["Your receipt", "Lunch on Friday?"]);
    for (const t of r.body.threads) expect(t.id).toMatch(/^[A-Za-z0-9_=.~-]+$/);
    expect(r.body.threads[0]).toMatchObject({ important: true, unread: false });
    expect(ms.state.requests.every((x) => x.prefer === 'IdType="ImmutableId"')).toBe(true);
    expect((await list("folder=inbox&q=is%3Aunread")).body.threads.map((t) => t.subject)).toEqual(["Lunch on Friday?"]);
    expect((await list("folder=inbox&q=receipt")).body.threads.map((t) => t.subject)).toEqual(["Your receipt"]);
    expect((await list("folder=important")).body.threads.map((t) => t.subject)).toEqual(["Your receipt"]);
    const all = await c.json<List>("/api/mail/threads?folder=inbox&account=all");
    expect(all.body.threads.some((t) => t.accountId === accountId)).toBe(true);

    const receipt = r.body.threads[0]!;
    const t = await c.json<{ inInbox: boolean; messages: Array<{ bodyText: string; from: { email: string }; attachments: Array<{ attachmentId: string; filename: string }> }> }>(`/api/mail/threads/${accountId}/${receipt.id}`);
    expect(t.status).toBe(200);
    expect(t.body.inInbox).toBe(true);
    expect(t.body.messages[0]).toMatchObject({ from: { email: "shop@example.com" } });
    expect(t.body.messages[0]!.attachments).toEqual([expect.objectContaining({ attachmentId: "a0", filename: "r.txt" })]);
    const att = await c.raw(`/api/mail/attachments/${accountId}/${receipt.id}/a0`);
    expect(att.status).toBe(200);
    expect(await att.text()).toContain("TOTAL 42");
    expect((await c.raw(`/api/mail/threads/${accountId}/bad%2Fid`)).status).toBeGreaterThanOrEqual(400);
  });

  it("applies flags and moves, and degrades labels", async () => {
    const lunch = (await list("folder=inbox")).body.threads.find((t) => t.subject === "Lunch on Friday?")!;
    for (const action of ["read", "star", "important"]) expect((await post(`/api/mail/threads/${accountId}/${lunch.id}/action`, { action })).status).toBe(200);
    const flagged = (await list("folder=starred")).body.threads;
    expect(flagged).toEqual([expect.objectContaining({ subject: "Lunch on Friday?", unread: false, starred: true, important: true })]);
    expect((await post(`/api/mail/threads/${accountId}/${lunch.id}/action`, { action: "archive" })).status).toBe(200);
    expect((await list("folder=inbox")).body.threads.map((x) => x.subject)).toEqual(["Your receipt"]);
    const archived = (await list("folder=archive")).body.threads;
    expect(archived).toEqual([expect.objectContaining({ subject: "Lunch on Friday?", starred: true })]);
    expect((await post(`/api/mail/threads/${accountId}/${archived[0]!.id}/action`, { action: "trash" })).status).toBe(200);
    expect((await list("folder=trash")).body.threads.map((x) => x.subject)).toEqual(["Lunch on Friday?"]);
    expect((await post(`/api/mail/threads/${accountId}/${archived[0]!.id}/labels`, { add: ["Label_1"], remove: [] })).status).toBe(400);
  });

  it("saves, reopens and sends drafts through Graph, removing the draft", async () => {
    const d = await post("/api/compose/drafts", { accountId, to: ["Ola <ola@example.org>"], subject: "Re: Lunch", text: "Friday works.", html: "<p>Friday works.</p>" });
    expect(d.status).toBe(200);
    const draftId = d.body.draftId as string;
    const got = await c.json<{ subject: string; to: Array<{ email: string }> }>(`/api/compose/drafts/${accountId}/${draftId}`);
    expect(got.body).toMatchObject({ subject: "Re: Lunch", to: [{ email: "ola@example.org" }] });
    expect((await c.json<{ drafts: unknown[] }>(`/api/mail/drafts?account=${accountId}`)).body.drafts).toHaveLength(1);
    const s = await post("/api/compose/send", { accountId, draftId, to: ["Ola <ola@example.org>"], bcc: ["boss@example.org"], subject: "Re: Lunch", text: "Friday works.", html: "<p>Friday works.</p>" });
    expect(s.status).toBe(200);
    expect(ms.state.sent).toHaveLength(1);
    expect(ms.state.sent[0]).toMatch(/^From: "?Alex Outlook"? <alex@outlook.example>/m);
    expect((await list("folder=sent")).body.threads.map((x) => x.subject)).toEqual(["Re: Lunch"]);
    expect((await c.json<{ drafts: unknown[] }>(`/api/mail/drafts?account=${accountId}`)).body.drafts).toEqual([]);
    // The drafts API never deletes a real email.
    const receipt = (await list("folder=inbox")).body.threads[0]!;
    expect((await c.raw(`/api/compose/drafts/${accountId}/${receipt.id}`, { method: "DELETE" })).status).toBe(400);
    expect((await list("folder=inbox")).body.threads).toHaveLength(1);
  });

  it("detects new inbox mail with a delta query", async () => {
    const first = await c.json<{ accounts: Array<{ accountId: string; changed: boolean; error?: string }> }>("/api/mail/sync");
    expect(first.body.accounts.find((a) => a.accountId === accountId)).toMatchObject({ changed: false });
    expect(String((await sql`select history_id from accounts where id = ${accountId}`)[0]!.history_id)).toMatch(/^delta:/);
    const quiet = await c.json<{ accounts: Array<{ accountId: string; changed: boolean }> }>("/api/mail/sync");
    expect(quiet.body.accounts.find((a) => a.accountId === accountId)).toMatchObject({ changed: false, newInbox: 0 });
    await ms.addMessage({ folder: "inbox", mime: mime("Kim <kim@example.org>", "New one", "hello"), received: new Date(Date.now() + 1000).toISOString() });
    const next = await c.json<{ changed: boolean; accounts: Array<{ accountId: string; changed: boolean; newInbox: number }> }>("/api/mail/sync");
    expect(next.body.accounts.find((a) => a.accountId === accountId)).toEqual({ accountId, changed: true, newInbox: 1 });
  });

  it("refreshes expired tokens (rotating the refresh token) and asks to reconnect when revoked", async () => {
    const [before] = await sql`select refresh_token_enc from accounts where id = ${accountId}`;
    await sql`update accounts set access_token_expires_at = now() - interval '1 hour' where id = ${accountId}`;
    const n = ms.state.refreshCount;
    expect((await list("folder=inbox")).status).toBe(200);
    expect(ms.state.refreshCount).toBe(n + 1);
    const [after] = await sql`select refresh_token_enc, status from accounts where id = ${accountId}`;
    expect(after!.refresh_token_enc).not.toEqual(before!.refresh_token_enc);
    // A 401 from Graph with a valid-looking token also triggers one refresh.
    ms.state.tokens.clear();
    expect((await list("folder=inbox")).status).toBe(200);
    // Revoked: the refresh token no longer works.
    ms.state.tokens.clear();
    ms.state.refreshTokens.clear();
    const r = await c.json<{ error: { code: string } }>(`/api/mail/threads?folder=inbox&account=${accountId}`);
    expect(r.status).toBe(401);
    expect(String((await sql`select status from accounts where id = ${accountId}`)[0]!.status)).toBe("needs_reauth");
  });

  it("keeps Outlook accounts private to their owner", async () => {
    await fetch(`${h.google.url}/__control/identity`, { method: "POST", body: JSON.stringify({ sub: "7120", email: "gus2@fluent.test", name: "Gus" }) });
    const other = new Client(h);
    await other.login();
    await fetch(`${h.google.url}/__control/reset`, { method: "POST" });
    expect((await other.json(`/api/mail/threads?folder=inbox&account=${accountId}`)).status).toBe(404);
  });
});
