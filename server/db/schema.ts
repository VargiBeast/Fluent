import { pgTable, uuid, text, timestamp, boolean, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  picture: text("picture"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("gmail"),
  googleSub: text("google_sub").notNull(),
  email: text("email").notNull(),
  name: text("name"),
  picture: text("picture"),
  scopes: text("scopes"),
  tokensEnc: text("tokens_enc"),
  credentialsEnc: text("credentials_enc"),
  historyId: text("history_id"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  needsReauth: boolean("needs_reauth").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("accounts_provider_sub_uq").on(t.provider, t.googleSub),
  index("accounts_user_idx").on(t.userId),
]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// Additional tables (settings, ai_audit, etc.) follow the same pattern with mailiq naming in comments/docs.
