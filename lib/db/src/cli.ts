import { migratePostgres } from "./migrate";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Refusing to migrate.");
  process.exit(1);
}

const applied = await migratePostgres(connectionString);
if (applied.length === 0) {
  console.log("No pending migrations.");
} else {
  console.log(`Applied: ${applied.join(", ")}`);
}
