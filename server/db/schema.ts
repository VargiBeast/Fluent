import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * FLUENT stores no email bodies. Mail stays in Gmail and is fetched on demand.
 * Stored: identity, encrypted OAuth tokens, sessions, preferences, rate-limit counters,
 * and the AI access audit (ids + encrypted subjects only).
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  googleSub: text("google_sub").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  picture: text("picture"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("users_google_sub_uq").on(t.googleSub)]);

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  googleSub: text("google_sub").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  picture: text("picture"),
  scopes: text("scopes").notNull().default(""),
  refreshTokenEnc: text("refresh_token_enc"),
  accessTokenEnc: text("access_token_enc"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  historyId: text("history_id"),
  status: text("status").notNull().default("active"), // active | needs_reauth | insufficient_scopes
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("accounts_user_sub_uq").on(t.userId, t.googleSub),
  index("accounts_user_idx").on(t.userId),
]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256(session token); raw token only lives in the cookie
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  csrfToken: text("csrf_token").notNull(),
  userAgent: text("user_agent").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
  onboarded: boolean("onboarded").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiAudit = pgTable("ai_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: uuid("account_id"),
  feature: text("feature").notNull(),
  threadIds: text("thread_ids").array().notNull().default(sql`'{}'::text[]`),
  subjectsEnc: text("subjects_enc"), // AES-GCM encrypted JSON array of subjects
  itemCount: integer("item_count").notNull().default(0),
  excludedCount: integer("excluded_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("ai_audit_user_created_idx").on(t.userId, t.createdAt)]);

export const securityEvents = pgTable("security_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  detail: text("detail").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("security_events_user_idx").on(t.userId, t.createdAt)]);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.key, t.windowStart] })]);
