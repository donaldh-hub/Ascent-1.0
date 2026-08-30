import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Intelligence-Quality Agent's own release-decision record — one row per
 * evaluated ingestion batch. This is deliberately separate from the
 * generic agent_verification_results table (agent_runtime.ts): that table
 * is "did this one gate pass," this table is "was this batch released or
 * blocked, and what's the complete evidence for that call." Matches the
 * spec's "quality_release_decisions" minimum production table.
 *
 * Note: this agent evaluates and records decisions today; it does not yet
 * ENFORCE them by blocking Control Tower/reports/Jordan from serving a
 * blocked batch's data — that enforcement wiring touches every existing
 * read path and is a deliberately separate, later increment (see PR
 * description). Recording a real, evidence-backed decision now is still
 * genuine progress and not a placeholder — it's just not wired to gate
 * reads yet.
 */
export const qualityReleaseDecisionsTable = pgTable("quality_release_decisions", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id"), // the intelligence_quality_agent job that produced this decision
  ingestionJobId: integer("ingestion_job_id"), // the data_ingestion_agent job this evaluates
  batchId: text("batch_id").notNull(),
  decision: text("decision").notNull(), // "released" | "blocked"
  organizationId: integer("organization_id"),
  siteIds: integer("site_ids").array().notNull().default(sql`'{}'::integer[]`),
  checksRun: jsonb("checks_run").notNull(), // [{ gate: string; passed: boolean; evidence: unknown }]
  createdAt: timestamp("created_at").defaultNow(),
});

export type QualityReleaseDecision = typeof qualityReleaseDecisionsTable.$inferSelect;
