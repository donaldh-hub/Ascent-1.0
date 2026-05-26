import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Ascent — Build Auditor (internal)
 *
 * Lightweight history of audits run from the internal /dev/build-auditor page.
 * Not customer-facing. Stores enough to render a recent-audits sidebar and
 * re-open a past report without re-running the live checks.
 */

export const BUILD_AUDIT_STATUSES = [
  "pass",
  "partial",
  "fail",
  "needs_manual_verification",
] as const;

export type BuildAuditStatus = (typeof BUILD_AUDIT_STATUSES)[number];

export const buildAuditsTable = pgTable("build_audits", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  buildLabel: text("build_label").notNull(),
  status: text("status").$type<BuildAuditStatus>().notNull(),
  passCount: integer("pass_count").notNull().default(0),
  partialCount: integer("partial_count").notNull().default(0),
  failCount: integer("fail_count").notNull().default(0),
  manualCount: integer("manual_count").notNull().default(0),
  summary: text("summary").notNull(),
  reportMarkdown: text("report_markdown").notNull(),
  nextPromptMarkdown: text("next_prompt_markdown").notNull(),
  checkResults: jsonb("check_results").notNull(),
  bundleExtras: jsonb("bundle_extras"),
});

export type BuildAudit = typeof buildAuditsTable.$inferSelect;
export type NewBuildAudit = typeof buildAuditsTable.$inferInsert;
