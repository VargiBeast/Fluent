import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { applyMigrationsWithExec, ensureFluentRole } from "./migrate";

const { Pool } = pg;

export type FluentDatabase = ReturnType<typeof drizzlePg<typeof schema>>;

export type DbMode = "postgres" | "pglite" | "unconfigured";

let dbPromise: Promise<FluentDatabase> | null = null;
let mode: DbMode = "unconfigured";
let pool: pg.Pool | null = null;

export function getDbMode(): DbMode {
  return mode;
}

export function resetDbForTests(): void {
  dbPromise = null;
  mode = "unconfigured";
  if (pool) {
    void pool.end();
    pool = null;
  }
}

export function resolveDbMode(env: NodeJS.ProcessEnv): DbMode {
  if (env.DATABASE_URL) return "postgres";
  if (env.NODE_ENV === "production") return "unconfigured";
  if (env.FLUENT_DB === "pglite" || env.FLUENT_DEMO_MODE === "true") return "pglite";
  return "unconfigured";
}

export async function getDb(): Promise<FluentDatabase> {
  if (!dbPromise) {
    dbPromise = openDatabase().catch((error: unknown) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

async function openDatabase(): Promise<FluentDatabase> {
  mode = resolveDbMode(process.env);
  if (mode === "postgres") {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    return drizzlePg(pool, { schema });
  }
  if (mode === "pglite") {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const client = new PGlite();
    await ensureFluentRole((text) => client.exec(text));
    await applyMigrationsWithExec((text) => client.exec(text));
    return drizzle(client, { schema }) as unknown as FluentDatabase;
  }
  throw new Error("DATABASE_NOT_CONFIGURED");
}
