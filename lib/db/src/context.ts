import { sql } from "drizzle-orm";
import type { FluentDatabase } from "./client";
import { getDb } from "./client";

export type DbTransaction = Parameters<Parameters<FluentDatabase["transaction"]>[0]>[0];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value: string): string {
  if (!UUID_RE.test(value)) {
    throw new Error("INVALID_USER_ID");
  }
  return value;
}

/**
 * Product queries run as fluent_app with a transaction-local user id.
 * Row Level Security is forced, so a missing WHERE user_id still cannot
 * read another tenant. The user id comes from the verified session, never
 * from an unchecked browser field.
 */
export async function withUser<T>(
  userId: string,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  const id = assertUuid(userId);
  const db = await getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${id}, true)`);
    await tx.execute(sql`set local role fluent_app`);
    return fn(tx);
  });
}

/**
 * Owner connection. Bypasses RLS because the migration role owns the tables
 * and, on Supabase, is often a superuser. Use only for session lookup by
 * token hash and OAuth state consume, where the user id is not known yet.
 * Do not use this for mailbox reads or writes.
 */
export async function withOwner<T>(
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  const db = await getDb();
  return db.transaction(async (tx) => fn(tx));
}
