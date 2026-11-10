import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, startHarness, type Harness } from "./harness.js";
import type { ThreadDetail } from "../../shared/mail.js";

let h: Harness;
let c: Client;
let accountId: string;

beforeAll(async () => {
  h = await startHarness();
  c = new Client(h);
  await c.login();
  accountId = (await c.json<{ accounts: Array<{ id: string }> }>("/api/auth/session")).body.accounts[0]!.id;
});
afterAll(async () => { await h.close(); });

const box = () => h.google.mailbox("alex@fluent.test");

describe("Compose, reply, forward and drafts", () => {
  it("sends a new message with CC/BCC and an attachment through Gmail", async () => {
    const r = await c.json<{ id: string; threadId: string }>("/api/compose/send", {
      method: "POST",
      body: JSON.stringify({
        accountId, to: ["Jonas Berg <jonas@fjordlabs.example>"], cc: ["priya@northwind.example"], bcc: ["boss@northwind.example"],
        subject: "Status ✓", html: "<p>Hello <b>team</b></p>", text: "Hello team",
        attachments: [{ filename: "notes.txt", mimeType: "text/plain", data: Buffer.from("notes").toString("base64") }],
      }),
    });
    expect(r.status).toBe(200);
    const raw = box().sent.at(-1)!;
    expect(raw).toMatch(/^From: "Alex Morgan" <alex@fluent.test>/m);
    expect(raw).toMatch(/^To: "Jonas Berg" <jonas@fjordlabs.example>/m);
    expect(raw).toMatch(/^Cc: priya@northwind.example/m);
    expect(raw).toMatch(/^Bcc: boss@northwind.example/m);
    expect(raw).toContain('filename="notes.txt"');
    expect(box().messages.get(r.body.id)!.labelIds.has("SENT")).toBe(true);
  });

  it("replies in-thread with In-Reply-To/References", async () => {
    const t = (await c.json<ThreadDetail>(`/api/mail/threads/${accountId}/t-canary`)).body;
    const m = t.messages[0]!;
    const r = await c.json<{ threadId: string }>("/api/compose/send", {
      method: "POST",
      body: JSON.stringify({ accountId, to: [m.from.email], subject: `Re: ${m.subject}`, html: "<p>Works</p>", text: "Works", threadId: t.id, inReplyTo: m.messageIdHeader, references: m.messageIdHeader }),
    });
    expect(r.body.threadId).toBe("t-canary");
    expect(box().sent.at(-1)).toContain(`In-Reply-To: ${m.messageIdHeader}`);
    const after = (await c.json<ThreadDetail>(`/api/mail/threads/${accountId}/t-canary`)).body;
    expect(after.messages).toHaveLength(2);
    expect(after.messages[1]!.isFromMe).toBe(true);
  });

  it("forwards original attachments fetched server-side from Gmail", async () => {
    const t = (await c.json<ThreadDetail>(`/api/mail/threads/${accountId}/t-invoice`)).body;
    const a = t.messages[0]!.attachments[0]!;
    const r = await c.json("/api/compose/send", {
      method: "POST",
      body: JSON.stringify({ accountId, to: ["accounting@fjordlabs.example"], subject: "Fwd: invoice", html: "<p>FYI</p>", text: "FYI", attachments: [{ filename: a.filename, mimeType: a.mimeType, source: { messageId: a.messageId, attachmentId: a.attachmentId } }] }),
    });
    expect(r.status).toBe(200);
    const raw = box().sent.at(-1)!;
    expect(raw).toContain('filename="INV-20431.pdf"');
    expect(raw).toContain(Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n").toString("base64").slice(0, 20));
  });

  it("refuses to send AI-generated content without explicit confirmation", async () => {
    const before = box().sent.length;
    const r = await c.json<{ error: { code: string } }>("/api/compose/send", { method: "POST", body: JSON.stringify({ accountId, to: ["x@y.example"], subject: "AI", html: "<p>AI</p>", text: "AI", aiGenerated: true }) });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("ai_confirmation_required");
    expect(box().sent.length).toBe(before);
    const ok = await c.json("/api/compose/send", { method: "POST", body: JSON.stringify({ accountId, to: ["x@y.example"], subject: "AI", html: "<p>AI</p>", text: "AI", aiGenerated: true, aiConfirmed: true }) });
    expect(ok.status).toBe(200);
  });

  it("validates recipients and blocks header injection", async () => {
    const none = await c.json("/api/compose/send", { method: "POST", body: JSON.stringify({ accountId, subject: "x" }) });
    expect(none.status).toBe(400);
    const bad = await c.json("/api/compose/send", { method: "POST", body: JSON.stringify({ accountId, to: ["not-an-email"] }) });
    expect(bad.status).toBe(400);
    const inj = await c.json("/api/compose/send", { method: "POST", body: JSON.stringify({ accountId, to: ["a@b.example"], subject: "x\r\nBcc: evil@x.example" }) });
    expect(inj.status).toBe(400);
  });

  it("rejects attachments over the deployment limit", async () => {
    const big = Buffer.alloc(3_600_000, 1).toString("base64");
    const r = await c.json<{ error: { code: string } }>("/api/compose/send", { method: "POST", body: JSON.stringify({ accountId, to: ["a@b.example"], subject: "big", attachments: [{ filename: "big.bin", mimeType: "application/octet-stream", data: big }] }) });
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe("attachments_too_large");
  });

  it("creates, updates, reads, sends and deletes drafts in Gmail", async () => {
    const created = await c.json<{ draftId: string }>("/api/compose/drafts", { method: "POST", body: JSON.stringify({ accountId, to: ["jonas@fjordlabs.example"], subject: "Draft one", html: "<p>v1</p>", text: "v1" }) });
    expect(created.status).toBe(200);
    const id = created.body.draftId;
    const upd = await c.json<{ draftId: string }>("/api/compose/drafts", { method: "POST", body: JSON.stringify({ accountId, draftId: id, to: ["jonas@fjordlabs.example"], cc: ["priya@northwind.example"], subject: "Draft two", html: "<p>v2</p>", text: "v2" }) });
    expect(upd.body.draftId).toBe(id);
    const got = await c.json<{ subject: string; cc: Array<{ email: string }>; text: string }>(`/api/compose/drafts/${accountId}/${id}`);
    expect(got.body.subject).toBe("Draft two");
    expect(got.body.cc[0]!.email).toBe("priya@northwind.example");
    const list = await c.json<{ drafts: Array<{ draftId: string; subject: string }> }>("/api/mail/drafts");
    expect(list.body.drafts.map((d) => d.draftId)).toContain(id);
    const sent = await c.json("/api/compose/send", { method: "POST", body: JSON.stringify({ accountId, draftId: id, to: ["jonas@fjordlabs.example"], subject: "Draft final", html: "<p>v3</p>", text: "v3" }) });
    expect(sent.status).toBe(200);
    expect(box().drafts.has(id)).toBe(false);

    const d2 = await c.json<{ draftId: string }>("/api/compose/drafts", { method: "POST", body: JSON.stringify({ accountId, subject: "to delete" }) });
    expect((await c.json(`/api/compose/drafts/${accountId}/${d2.body.draftId}`, { method: "DELETE" })).status).toBe(200);
    expect(box().drafts.has(d2.body.draftId)).toBe(false);
  });

  it("cannot send from or read drafts of another user's account", async () => {
    await fetch(`${h.google.url}/__control/identity`, { method: "POST", body: JSON.stringify({ sub: "3003", email: "eve@fluent.test", name: "Eve" }) });
    const eve = new Client(h);
    await eve.login();
    await fetch(`${h.google.url}/__control/reset`, { method: "POST" });
    const r = await eve.json("/api/compose/send", { method: "POST", body: JSON.stringify({ accountId, to: ["x@y.example"], subject: "spoof" }) });
    expect(r.status).toBe(404);
  });
});
