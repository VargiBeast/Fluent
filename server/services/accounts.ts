import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { accounts, securityEvents, userSettings, users } from "../db/schema.js";
import { encrypt } from "../crypto.js";
import type { GoogleIdentity, TokenResponse } from "../auth/google.js";
import { REQUIRED_GMAIL_SCOPE } from "../auth/google.js";
import { notFound } from "../lib/errors.js";

export type AccountRow = typeof accounts.$inferSelect;

export interface PublicAccount {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  status: string;
  scopes: string[];
  color: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
}

export function toPublicAccount(a: AccountRow): PublicAccount {
  return {
    id: a.id,
    email: a.email,
    name: a.name,
    picture: a.picture,
    status: a.status,
    scopes: a.scopes.split(" ").filter(Boolean),
    color: a.color,
    lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

export async function upsertUser(identity: GoogleIdentity): Promise<{ id: string; isNew: boolean }> {
  const db = getDb();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.googleSub, identity.sub)).limit(1);
  if (existing[0]) {
    await db.update(users).set({ email: identity.email, name: identity.name, picture: identity.picture, updatedAt: new Date() }).where(eq(users.id, existing[0].id));
    return { id: existing[0].id, isNew: false };
  }
  const [row] = await db.insert(users).values({ googleSub: identity.sub, email: identity.email, name: identity.name, picture: identity.picture }).returning({ id: users.id });
  await db.insert(userSettings).values({ userId: row!.id }).onConflictDoNothing();
  return { id: row!.id, isNew: true };
}

/** Insert or refresh the Gmail connection for (user, google account). Tokens are AES-GCM encrypted. */
export async function upsertAccount(userId: string, identity: GoogleIdentity, tokens: TokenResponse): Promise<AccountRow> {
  const db = getDb();
  const scopes = tokens.scope ?? "";
  const status = scopes.split(" ").includes(REQUIRED_GMAIL_SCOPE) ? "active" : "insufficient_scopes";
  const aad = `${userId}:${identity.sub}`;
  const values = {
    email: identity.email,
    name: identity.name,
    picture: identity.picture,
    scopes,
    accessTokenEnc: encrypt(tokens.access_token, "token", aad),
    accessTokenExpiresAt: new Date(Date.now() + (tokens.expires_in - 60) * 1000),
    status,
    updatedAt: new Date(),
    ...(tokens.refresh_token ? { refreshTokenEnc: encrypt(tokens.refresh_token, "token", aad) } : {}),
  };
  const [row] = await db
    .insert(accounts)
    .values({ userId, googleSub: identity.sub, ...values })
    .onConflictDoUpdate({ target: [accounts.userId, accounts.googleSub], set: values })
    .returning();
  if (!row!.refreshTokenEnc) {
    await db.update(accounts).set({ status: "needs_reauth" }).where(eq(accounts.id, row!.id));
    row!.status = "needs_reauth";
  }
  return row!;
}

export async function listAccounts(userId: string): Promise<AccountRow[]> {
  return getDb().select().from(accounts).where(eq(accounts.userId, userId)).orderBy(asc(accounts.createdAt));
}

/** Every account lookup is scoped to the session user: no cross-user access is possible. */
export async function getOwnedAccount(userId: string, accountId: string): Promise<AccountRow> {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) throw notFound("Account not found");
  const rows = await getDb().select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.userId, userId))).limit(1);
  if (!rows[0]) throw notFound("Account not found");
  return rows[0];
}

export async function logSecurityEvent(userId: string, type: string, detail = ""): Promise<void> {
  await getDb().insert(securityEvents).values({ userId, type, detail: detail.slice(0, 300) });
}
