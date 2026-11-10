import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, startHarness, type Harness } from "./harness.js";

let h: Harness;
let c: Client;
let accountId: string;
const ME = "alex@fluent.test";

interface Identity { sendAsEmail: string; displayName: string; signature: string; isPrimary: boolean }
interface SendAsAccount { accountId: string; email: string; identities: Identity[]; error?: { code: string } }

beforeAll(async () => {
  h = await startHarness();
  c = new Client(h);
  await c.login();
  accountId = (await c.json<{ accounts: Array<{ id: string }> }>("/api/auth/session")).body.accounts[0]!.id;
});
afterAll(async () => { await h.close(); });

const patch = (cl: Client, email: string, body: unknown, acc = accountId) =>
  cl.json<Identity>(`/api/send-as/${acc}/${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify(body) });

describe("Gmail send-as: display name and signature", () => {
  it("lists the send-as identities from Gmail", async () => {
    const r = await c.json<{ accounts: SendAsAccount[] }>("/api/send-as");
    expect(r.status).toBe(200);
    expect(r.body.accounts).toHaveLength(1);
    expect(r.body.accounts[0]).toMatchObject({ accountId, email: ME });
    expect(r.body.accounts[0]!.identities[0]).toMatchObject({ sendAsEmail: ME, isPrimary: true });
  });

  it("updates the display name and signature in Gmail, stripping active content", async () => {
    const r = await patch(c, ME, { displayName: "Alex R.", signature: '<div>Alex <b>R.</b></div><script>alert(1)</script><a href="javascript:x" onclick="y">x</a>' });
    expect(r.status).toBe(200);
    const stored = h.google.mailbox(ME).sendAs!.get(ME)!;
    expect(stored.displayName).toBe("Alex R.");
    expect(stored.signature).toContain("<b>R.</b>");
    expect(stored.signature).not.toMatch(/script|javascript:|onclick/i);
    const list = await c.json<{ accounts: SendAsAccount[] }>("/api/send-as");
    expect(list.body.accounts[0]!.identities[0]!.displayName).toBe("Alex R.");
  });

  it("uses the Gmail display name in the From header of mail sent from FLUENT", async () => {
    const before = h.google.mailbox(ME).sent.length;
    const r = await c.json("/api/compose/send", { method: "POST", body: JSON.stringify({ accountId, to: ["sam@example.test"], subject: "Name check", html: "<p>Hi</p>", text: "Hi" }) });
    expect(r.status).toBe(200);
    const raw = h.google.mailbox(ME).sent[before]!;
    expect(raw).toMatch(/^From: "Alex R\." <alex@fluent\.test>/m);
  });

  it("validates input", async () => {
    expect((await patch(c, ME, {})).status).toBe(400);
    expect((await patch(c, ME, { displayName: "Evil\r\nBcc: x@y.test" })).status).toBe(400);
    expect((await patch(c, ME, { displayName: 'A "B" <c@d>' })).status).toBe(400);
    expect((await patch(c, ME, { signature: "x".repeat(10_001) })).status).toBe(400);
    expect((await patch(c, ME, { displayName: "ok", extra: true })).status).toBe(400);
    expect((await patch(c, "not-an-email", { displayName: "ok" })).status).toBe(400);
    // Only addresses Gmail lists for the account can be targeted.
    expect((await patch(c, "someone@else.test", { displayName: "ok" })).status).toBe(404);
  });

  it("isolates accounts per user", async () => {
    await fetch(`${h.google.url}/__control/identity`, { method: "POST", body: JSON.stringify({ sub: "7007", email: "eve@fluent.test", name: "Eve" }) });
    const other = new Client(h);
    await other.login();
    await fetch(`${h.google.url}/__control/reset`, { method: "POST" });
    const mine = await other.json<{ accounts: SendAsAccount[] }>("/api/send-as");
    expect(mine.body.accounts.map((a) => a.email)).toEqual(["eve@fluent.test"]);
    expect((await patch(other, ME, { displayName: "Pwned" })).status).toBe(404);
    expect(h.google.mailbox(ME).sendAs!.get(ME)!.displayName).toBe("Alex R.");
    expect((await new Client(h).json("/api/send-as")).status).toBe(401);
  });
});
