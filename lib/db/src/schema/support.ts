import { pgTable, serial, integer, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

/**
 * Customer-Support Agent's case record (Build Sequence step 6). No
 * support-ticketing concept existed in this codebase before — this isn't
 * shadowing anything, it's genuinely new. Kept deliberately small: a
 * category, a status, and a diagnostics blob, matching what the agent
 * can actually do today (resend a login link, gather real ingestion
 * diagnostics) rather than a full helpdesk schema for capabilities that
 * don't exist yet.
 */
export const SUPPORT_CASE_CATEGORIES = ["login_failure", "upload_failure", "other"] as const;
export type SupportCaseCategory = typeof SUPPORT_CASE_CATEGORIES[number];

export const SUPPORT_CASE_STATUSES = ["open", "monitoring", "resolved", "escalated"] as const;
export type SupportCaseStatus = typeof SUPPORT_CASE_STATUSES[number];

export const supportCasesTable = pgTable("support_cases", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("open"),
  diagnostics: jsonb("diagnostics"),
  recoveryAttempted: boolean("recovery_attempted").notNull().default(false),
  recoveryOutcome: text("recovery_outcome"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type SupportCase = typeof supportCasesTable.$inferSelect;
