import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, startHarness, TEST_DB_URL, type Harness } from "./harness.js";

// An account row of another provider kind must not break Gmail accounts, and Gmail-only features must say so clearly.
let h: Harness;
let c: Client;
let gmailId: string;
let otherId: string;
const sql = postgres(TEST_DB_URL, { onnotice: () => {} });

beforeAll(async () => {
  h = await startHarness();
  c = new Client(h);
  await c.login();
  gmailId = (await c.json<{ accounts: Array<{ id: string }> }>("/api/auth/session")).body.accounts[0]!.id;
  const [u] = await sql`select user_id from accounts where id = ${gmailId}`;
  const [row] = await sql`insert into accounts (user_id, google_sub, provider, email) values (${u!.user_id}, 'imap:me@mail.example', 'imap', 'me@mail.example') returning id`;
  otherId = row!.id as string;
});
afterAll(async () => { await sql.end(); await h.close(); });

describe("Mail providers", () => {
  it("lists every account with its provider and capabilities", async () => {
    const s = await c.json<{ accounts: Array<{ id: string; provider: string; capabilities: { categories: boolean; filters: boolean } }> }>("/api/auth/session");
    const g = s.body.accounts.find((a) => a.id === gmailId)!;
    const o = s.body.accounts.find((a) => a.id === otherId)!;
    expect(g).toMatchObject({ provider: "gmail", capabilities: { categories: true, filters: true } });
    expect(o).toMatchObject({ provider: "imap", capabilities: { categories: false, filters: false } });
  });

  it("keeps Gmail working in the all-accounts inbox and reports the other account separately", async () => {
    const r = await c.json<{ threads: Array<{ accountId: string }>; errors: Array<{ accountId: string; code: string }> }>("/api/mail/threads?folder=inbox&account=all");
    expect(r.status).toBe(200);
    expect(r.body.threads.length).toBeGreaterThan(0);
    expect(r.body.threads.every((t) => t.accountId === gmailId)).toBe(true);
    expect(r.body.errors).toEqual([expect.objectContaining({ accountId: otherId, code: "account_reauth" })]);
    // Gmail categories simply show nothing for the other account rather than failing.
    const cat = await c.json<{ errors: unknown[] }>("/api/mail/threads?folder=inbox&account=all&category=social");
    expect(cat.body.errors).toEqual([]);
  });

  it("refuses Gmail-only features on other providers with a clear error", async () => {
    const f = await c.json<{ error?: { code: string } } & { code?: string }>(`/api/mail/filters?account=${otherId}`);
    expect(f.status).toBe(400);
    expect(JSON.stringify(f.body)).toContain("not_supported_for_provider");
    const sync = await c.json<{ accounts: Array<{ accountId: string; error?: string }> }>("/api/mail/sync");
    expect(sync.status).toBe(200);
    expect(sync.body.accounts.find((a) => a.accountId === otherId)?.error).toBe("account_reauth");
  });

  it("rejects unknown provider kinds at the database", async () => {
    await expect(sql`update accounts set provider = 'aol' where id = ${otherId}`).rejects.toThrow(/accounts_provider_ck/);
  });
});
