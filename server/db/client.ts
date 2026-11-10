import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { getEnv } from "../env.js";
import { notConfigured } from "../lib/errors.js";

export type DB = PostgresJsDatabase<typeof schema>;

let sqlClient: ReturnType<typeof postgres> | undefined;
let dbInstance: DB | undefined;

export function hasDatabase(): boolean {
  return Boolean(getEnv().DATABASE_URL);
}

function sslFor(url: string): "require" | false {
  const mode = getEnv().DATABASE_SSL;
  if (mode === "require") return "require";
  if (mode === "disable") return false;
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1" ? false : "require";
}

export function getDb(): DB {
  if (dbInstance) return dbInstance;
  const url = getEnv().DATABASE_URL;
  if (!url) throw notConfigured("Database");
  sqlClient = postgres(url, {
    max: getEnv().NODE_ENV === "production" ? 3 : 10,
    ssl: sslFor(url),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // compatible with transaction-mode poolers (Supabase/PgBouncer)
    onnotice: () => {},
  });
  dbInstance = drizzle(sqlClient, { schema });
  return dbInstance;
}

export async function closeDb(): Promise<void> {
  await sqlClient?.end({ timeout: 5 });
  sqlClient = undefined;
  dbInstance = undefined;
}
