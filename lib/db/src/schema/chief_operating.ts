import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Chief Operating Agent's own tables (Build Sequence step 9 — the last
 * department agent, and the one the Founder Control Center is built
 * around). Two of the spec's "Minimum Production Tables" are genuinely
 * needed here: agent_incidents (consolidating related exceptions so the
 * founder sees one thing, not five) and founder_decisions (recording
 * what Donald actually decided, so it can be routed back).
 *
 * Deliberately NOT built as persisted tables: chief_operating_health and
 * chief_operating_briefings. Both are computed LIVE from existing data
 * (agent_jobs, agent_exceptions, quality_release_decisions, etc.) every
 * time they're requested — see chief-operating-agent.ts's
 * getOperatingHealth()/getFounderBriefing(). A stored snapshot would
 * need its own staleness handling for no real benefit at this scale;
 * computing fresh is simpler and can't go stale.
 */
export const agentIncidentsTable = pgTable("agent_incidents", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  severity: text("severity").notNull(),
  status: text("status").notNull().default("open"), // open | resolved
  exceptionIds: integer("exception_ids").array().notNull().default(sql`'{}'::integer[]`),
  agentIds: text("agent_ids").array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export type AgentIncident = typeof agentIncidentsTable.$inferSelect;

export const founderDecisionsTable = pgTable("founder_decisions", {
  id: serial("id").primaryKey(),
  exceptionId: integer("exception_id"),
  incidentId: integer("incident_id"),
  decision: text("decision").notNull(),
  decidedByUserId: integer("decided_by_user_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type FounderDecision = typeof founderDecisionsTable.$inferSelect;
