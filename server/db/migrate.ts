import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { closeDb, getDb } from "./client.js";

export async function runMigrations(): Promise<void> {
  const folder = fileURLToPath(new URL("../../drizzle", import.meta.url));
  await migrate(getDb(), { migrationsFolder: folder });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMigrations()
    .then(async () => {
      await closeDb();
      process.stdout.write("MailIQ migrations applied\n");
    })
    .catch(async (err: unknown) => {
      await closeDb();
      process.stderr.write(`Migration failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
