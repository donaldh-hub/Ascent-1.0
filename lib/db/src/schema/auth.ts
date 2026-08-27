import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Single-use, short-lived magic-link tokens. Passwordless by design — see
 * core.md's "simple bridge first" scope: no password storage, no real
 * billing integration yet, just a real identity per person.
 */
export const loginTokensTable = pgTable("login_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type LoginToken = typeof loginTokensTable.$inferSelect;

/**
 * An authenticated user session, created once a login token is verified.
 * Deliberately separate from sessions.ts (the anonymous pre-login token used
 * to track unauthenticated report uploads) — the two are unrelated concerns.
 */
export const userSessionsTable = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type UserSession = typeof userSessionsTable.$inferSelect;
