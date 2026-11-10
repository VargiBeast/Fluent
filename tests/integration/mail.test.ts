import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, startHarness, TEST_DB_URL, type Harness } from "./harness.js";
import type { LabelsResponse, ThreadDetail, ThreadPage } from "../../shared/mail.js";
import { buildRaw } from "../fakes/seed.js";

let h: Harness;
let c: Client;
let accountId: string;

beforeAll(async () => {
  h = await startHarness();
  c = new Client(h);
  await c.login();
  const s = await c.json<{ accounts: Array<{ id: string }> }>("/api/auth/session");
  accountId = s.body.accounts[0]!.id;
});
afterAll(async () => { await h.close(); });

describe("Gmail inbox, threads and reader actions (HTTP fake Gmail)", () => {
  it("lists the inbox newest-first with summaries, and paginates with a cursor", async () => {
    const p1 = await c.json<ThreadPage>("/api/mail/threads?folder=inbox&limit=10");
    expect(p1.status).toBe(200);
    expect(p1.body.threads).toHaveLength(10);
    const first = p1.body.threads[0]!;
    expect(first.subject).toBe("Q4 design review — can you confirm Thursday?");
    expect(first.from.email).toBe("sofia@northwind.example");
    expect(first.unread && first.starred && first.important).toBe(true);
    const dates = p1.body.threads.map((t) => t.lastDate);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await c.json<ThreadPage>(`/api/mail/threads?folder=inbox&limit=10&cursor=${p1.body.nextCursor}`);
    expect(p2.body.threads).toHaveLength(10);
    expect(p2.body.threads.some((t) => p1.body.threads.some((x) => x.id === t.id))).toBe(false);
  });

  it("groups conversations and filters categories and folders", async () => {
    const promos = await c.json<ThreadPage>("/api/mail/threads?folder=inbox&category=promotions");
    expect(promos.body.threads.map((t) => t.id).sort()).toEqual(["t-injection", "t-news"]);
    const sent = await c.json<ThreadPage>("/api/mail/threads?folder=sent");
    expect(sent.body.threads.map((t) => t.id)).toContain("t-waiting");
    const trash = await c.json<ThreadPage>("/api/mail/threads?folder=trash");
    expect(trash.body.threads.map((t) => t.id)).toEqual(["t-trash"]);
    const archive = await c.json<ThreadPage>("/api/mail/threads?folder=archive");
    expect(archive.body.threads.map((t) => t.id)).toEqual(["t-archived"]);
    const team = (await c.json<ThreadPage>("/api/mail/threads?folder=inbox&limit=50")).body.threads.find((t) => t.id === "t-team")!;
    expect(team.messageCount).toBe(2);
    expect(team.hasAttachments).toBe(true);
  });

  it("supports traditional Gmail search syntax", async () => {
    const r = await c.json<ThreadPage>(`/api/mail/threads?folder=all&q=${encodeURIComponent("from:billing@brightline.example has:attachment")}`);
    expect(r.body.threads.map((t) => t.id)).toEqual(["t-invoice"]);
  });

  it("reads a full thread with parsed bodies, recipients and attachments", async () => {
    const r = await c.json<ThreadDetail>(`/api/mail/threads/${accountId}/t-team`);
    expect(r.status).toBe(200);
    expect(r.body.messages).toHaveLength(2);
    const m0 = r.body.messages[0]!;
    expect(m0.from).toEqual({ name: "Marcus Chen", email: "marcus@northwind.example" });
    expect(m0.to.map((a) => a.email)).toEqual(["alex@fluent.test", "priya@northwind.example"]);
    expect(m0.bodyText).toContain("release notes");
    expect(m0.attachments[0]).toMatchObject({ filename: "checklist.png", mimeType: "image/png" });
    expect(r.body.messages[1]!.references).toContain("t-team-");
  });

  it("downloads attachments as opaque, nosniff downloads", async () => {
    const t = await c.json<ThreadDetail>(`/api/mail/threads/${accountId}/t-invoice`);
    const att = t.body.messages[0]!.attachments[0]!;
    const res = await c.raw(`/api/mail/attachments/${accountId}/${att.messageId}/${att.attachmentId}?name=${encodeURIComponent("../../INV.pdf")}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).not.toContain("/");
    expect((await res.text()).startsWith("%PDF")).toBe(true);
  });

  it("syncs every reader action to Gmail", async () => {
    const box = h.google.mailbox("alex@fluent.test");
    const labelsOf = (tid: string) => new Set([...box.messages.values()].filter((m) => m.threadId === tid).flatMap((m) => [...m.labelIds]));
    const act = (action: string) => c.json(`/api/mail/threads/${accountId}/t-school/action`, { method: "POST", body: JSON.stringify({ action }) });
    expect((await act("star")).status).toBe(200);
    expect(labelsOf("t-school").has("STARRED")).toBe(true);
    await act("unread");
    expect(labelsOf("t-school").has("UNREAD")).toBe(true);
    await act("read");
    expect(labelsOf("t-school").has("UNREAD")).toBe(false);
    await act("important");
    expect(labelsOf("t-school").has("IMPORTANT")).toBe(true);
    await act("archive");
    expect(labelsOf("t-school").has("INBOX")).toBe(false);
    await act("inbox");
    expect(labelsOf("t-school").has("INBOX")).toBe(true);
    await act("trash");
    expect(labelsOf("t-school").has("TRASH")).toBe(true);
    await act("untrash");
    expect(labelsOf("t-school").has("TRASH")).toBe(false);
    const bad = await c.json(`/api/mail/threads/${accountId}/t-school/action`, { method: "POST", body: JSON.stringify({ action: "forward_all" }) });
    expect(bad.status).toBe(400);
  });

  it("manages labels: create, apply, rename, delete", async () => {
    const created = await c.json<{ id: string }>("/api/mail/labels", { method: "POST", body: JSON.stringify({ accountId, name: "Follow up" }) });
    expect(created.status).toBe(201);
    const apply = await c.json(`/api/mail/threads/${accountId}/t-flight/labels`, { method: "POST", body: JSON.stringify({ add: [created.body.id] }) });
    expect(apply.status).toBe(200);
    const unknown = await c.json(`/api/mail/threads/${accountId}/t-flight/labels`, { method: "POST", body: JSON.stringify({ add: ["TRASH"] }) });
    expect(unknown.status).toBe(400);
    const rn = await c.json(`/api/mail/labels/${accountId}/${created.body.id}`, { method: "PATCH", body: JSON.stringify({ name: "Follow-up" }) });
    expect(rn.status).toBe(200);
    const labels = await c.json<LabelsResponse>("/api/mail/labels");
    const acc = labels.body.accounts[0]!;
    expect(acc.labels.map((l) => l.name)).toEqual(["Clients", "Follow-up", "Receipts", "Travel"]);
    expect(acc.counts.INBOX).toBeGreaterThan(0);
    const del = await c.json(`/api/mail/labels/${accountId}/${created.body.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
  });

  it("manages Gmail filters with validation", async () => {
    const bad = await c.json("/api/mail/filters", { method: "POST", body: JSON.stringify({ accountId, criteria: {}, action: { removeLabelIds: ["INBOX"] } }) });
    expect(bad.status).toBe(400);
    const ok = await c.json<{ id: string }>("/api/mail/filters", { method: "POST", body: JSON.stringify({ accountId, criteria: { from: "deals@promo.example" }, action: { removeLabelIds: ["INBOX"], addLabelIds: ["Label_3"] } }) });
    expect(ok.status).toBe(201);
    const list = await c.json<{ filters: Array<{ id: string }> }>(`/api/mail/filters?account=${accountId}`);
    expect(list.body.filters).toHaveLength(1);
    expect((await c.json(`/api/mail/filters/${accountId}/${ok.body.id}`, { method: "DELETE" })).status).toBe(200);
  });

  it("detects new mail through history sync", async () => {
    const first = await c.json<{ changed: boolean }>("/api/mail/sync");
    expect(first.status).toBe(200);
    h.google.state.gmail.deliver("alex@fluent.test", buildRaw({ from: "\"New Person\" <new@fresh.example>", to: "alex@fluent.test", subject: "Fresh mail", text: "hello", date: new Date(), messageId: "<fresh@x>" }));
    const second = await c.json<{ changed: boolean; newInbox: number }>("/api/mail/sync");
    expect(second.body).toMatchObject({ changed: true, newInbox: 1 });
    const third = await c.json<{ changed: boolean }>("/api/mail/sync");
    expect(third.body.changed).toBe(false);
  });

  it("refreshes expired access tokens transparently and stores the new one encrypted", async () => {
    const sql = postgres(TEST_DB_URL, { onnotice: () => {} });
    await sql`update accounts set access_token_expires_at = now() - interval '1 hour'`;
    const r = await c.json<ThreadPage>("/api/mail/threads?limit=5");
    expect(r.status).toBe(200);
    const [row] = await sql`select access_token_expires_at from accounts`;
    await sql.end();
    expect(new Date(row!.access_token_expires_at as string).getTime()).toBeGreaterThan(Date.now());
  });

  it("marks the account for re-auth when Google revokes the refresh token", async () => {
    const sql = postgres(TEST_DB_URL, { onnotice: () => {} });
    await sql`update accounts set access_token_expires_at = now() - interval '1 hour'`;
    h.google.state.failRefresh = true;
    const r = await c.json<{ error: { code: string } }>("/api/mail/threads?limit=5");
    h.google.state.failRefresh = false;
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("account_reauth");
    const [row] = await sql`select status from accounts`;
    expect(row!.status).toBe("needs_reauth");
    await sql`update accounts set status = 'active'`;
    await sql.end();
  });

  it("isolates users: another user cannot read this user's account or threads", async () => {
    await fetch(`${h.google.url}/__control/identity`, { method: "POST", body: JSON.stringify({ sub: "2002", email: "mallory@fluent.test", name: "Mallory" }) });
    const other = new Client(h);
    await other.login();
    await fetch(`${h.google.url}/__control/reset`, { method: "POST" });
    const steal = await other.json(`/api/mail/threads/${accountId}/t-canary`);
    expect(steal.status).toBe(404);
    const list = await other.json(`/api/mail/threads?account=${accountId}`);
    expect(list.status).toBe(404);
    const act = await other.json(`/api/mail/threads/${accountId}/t-canary/action`, { method: "POST", body: JSON.stringify({ action: "trash" }) });
    expect(act.status).toBe(404);
    const att = await other.raw(`/api/mail/attachments/${accountId}/x/y`);
    expect(att.status).toBe(404);
  });

  it("validates ids and rejects unauthenticated access", async () => {
    expect((await c.json(`/api/mail/threads/${accountId}/..%2F..%2Fprofile`)).status).toBe(400);
    expect((await c.json(`/api/mail/threads/not-a-uuid/t-canary`)).status).toBe(400);
    const anon = new Client(h);
    expect((await anon.json("/api/mail/threads")).status).toBe(401);
  });
});
