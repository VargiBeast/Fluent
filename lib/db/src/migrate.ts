import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

export interface MigrationFile {
  version: string;
  sql: string;
}

const migrationDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

export async function readMigrationFiles(): Promise<MigrationFile[]> {
  const names = (await readdir(migrationDir))
    .filter((name) => /^[0-9]+_[a-z0-9_]+\.sql$/i.test(name))
    .sort();
  const files: MigrationFile[] = [];
  for (const name of names) {
    files.push({
      version: name,
      sql: await readFile(path.join(migrationDir, name), "utf8"),
    });
  }
  return files;
}

export async function ensureFluentRole(
  query: (sql: string) => Promise<unknown>,
): Promise<void> {
  await query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'fluent_app') then
        create role fluent_app nologin nosuperuser nobypassrls noinherit;
      end if;
    end
    $$;
  `);
  await query(`
    do $$
    begin
      if not exists (
        select 1
        from pg_auth_members m
        join pg_roles r on r.oid = m.roleid
        join pg_roles u on u.oid = m.member
        where r.rolname = 'fluent_app' and u.rolname = current_user
      ) then
        grant fluent_app to current_user;
      end if;
    end
    $$;
  `);
}

/**
 * Applies versioned SQL files. Safe to re-run. Refuses drizzle-kit push.
 * Does not print connection strings.
 */
export async function migratePostgres(connectionString: string): Promise<string[]> {
  const client = new Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await ensureFluentRole((text) => client.query(text));
    await client.query(`
      create table if not exists schema_migrations (
        version text primary key,
        applied_at timestamptz not null default now()
      )
    `);
    const existing = await client.query<{ version: string }>(
      "select version from schema_migrations",
    );
    const have = new Set(existing.rows.map((row) => row.version));
    for (const file of await readMigrationFiles()) {
      if (have.has(file.version)) continue;
      await client.query("begin");
      try {
        await client.query(file.sql);
        await client.query("insert into schema_migrations(version) values ($1)", [
          file.version,
        ]);
        await client.query("commit");
        applied.push(file.version);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

export async function applyMigrationsWithExec(
  exec: (sql: string) => Promise<unknown>,
  queryApplied?: () => Promise<Set<string>>,
): Promise<string[]> {
  await ensureFluentRole(exec);
  const files = await readMigrationFiles();
  const have = queryApplied ? await queryApplied() : new Set<string>();
  const applied: string[] = [];
  for (const file of files) {
    if (have.has(file.version)) continue;
    await exec(file.sql);
    await exec(
      `insert into schema_migrations(version) values ('${file.version.replace(/'/g, "")}') on conflict do nothing`,
    );
    applied.push(file.version);
  }
  return applied;
}
