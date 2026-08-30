import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

/**
 * The shared runtime platform for Ascent's agent-operated company (see
 * "Ascent 1.0 — Agent Job Descriptions and Operating Authority" and
 * "Ascent 1.0 — Executable Agent Build Specifications", both reviewed
 * 2026-08-28). This is Build-Sequence steps 1-3 from that spec: the job
 * state machine, policy/permission enforcement, and audit/evidence/
 * exception queue that every department agent (Sales, Onboarding,
 * Data-Ingestion, Intelligence-Quality, Jordan, Support, Billing,
 * Infrastructure, Security, Chief Operating Agent) runs on top of.
 *
 * Naming bridge to the spec's vocabulary: the spec says "organization" —
 * this codebase's existing single-tenant concept is "hub" (see
 * account_status.ts). The spec says "site" — this codebase's existing
 * table is "properties". agentOrganizationId/agentSiteIds below map
 * 1:1 to hubId/propertyId; new agent code should resolve real
 * organization/site truth from the EXISTING users/user_site_access/
 * properties tables, never invent a parallel org or site record. That's
 * the spec's own rule 2 of the Shared Runtime Contract: "shadow
 * databases and duplicate scoring, billing, access, or reporting logic
 * are prohibited."
 *
 * Infra decision (confirmed 2026-08-28): Postgres-backed job table +
 * in-process polling, not a separate queue service (Redis/BullMQ) — this
 * app has no queue infrastructure today and deploys as a single process,
 * so agent_jobs IS the queue. Upgradeable later without changing the
 * agent-facing API if throughput ever demands it.
 */

// ─── Canonical agent job states (spec: "Canonical Agent Job States") ─────────
export const AGENT_JOB_STATES = [
  "QUEUED",
  "RUNNING",
  "WAITING_FOR_INPUT",
  "VERIFYING",
  "COMPLETED",
  "RETRY_SCHEDULED",
  "QUARANTINED",
  "BLOCKED_BY_POLICY",
  "BLOCKED_BY_QUALITY",
  "FAILED_RECOVERABLE",
  "FAILED_FINAL",
  "ESCALATED",
] as const;
export type AgentJobState = typeof AGENT_JOB_STATES[number];

export const AGENT_EXCEPTION_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type AgentExceptionSeverity = typeof AGENT_EXCEPTION_SEVERITIES[number];

// ─── Registry ─────────────────────────────────────────────────────────────────

export const agentDefinitionsTable = pgTable("agent_definitions", {
  id: serial("id").primaryKey(),
  agentId: text("agent_id").notNull().unique(), // e.g. "sales_agent" — matches the spec's Runtime Identity
  name: text("name").notNull(),
  mission: text("mission").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AgentDefinition = typeof agentDefinitionsTable.$inferSelect;

// Which tool/action names each agent is allowed to call — the "Operating
// Authority may / may not" boundary from the job-description doc, made
// enforceable instead of just documented.
export const agentToolPermissionsTable = pgTable("agent_tool_permissions", {
  id: serial("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  toolName: text("tool_name").notNull(),
  allowed: boolean("allowed").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Versioned so a policy change is itself auditable — "which rules were in
// effect when this job ran" is always answerable.
export const agentPolicyVersionsTable = pgTable("agent_policy_versions", {
  id: serial("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  version: integer("version").notNull(),
  policy: jsonb("policy").notNull(),
  activatedAt: timestamp("activated_at").defaultNow(),
});

// ─── Job store ──────────────────────────────────────────────────────────────

export const agentJobsTable = pgTable("agent_jobs", {
  id: serial("id").primaryKey(),
  correlationId: text("correlation_id").notNull(),
  agentId: text("agent_id").notNull(),
  triggerEvent: text("trigger_event").notNull(), // e.g. "lead.created" — see each agent's "Start Triggers"
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  // Naming bridge: organizationId -> hubId, siteIds -> propertyIds (see file header).
  organizationId: integer("organization_id"),
  siteIds: integer("site_ids").array().notNull().default(sql`'{}'::integer[]`),
  authorizedUserId: integer("authorized_user_id"),
  state: text("state").notNull().default("QUEUED"),
  attempt: integer("attempt").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  nextRunAt: timestamp("next_run_at").defaultNow(),
  lastError: text("last_error"),
  result: jsonb("result"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type AgentJob = typeof agentJobsTable.$inferSelect;

// Every state transition, not just the final one — "explain what happened"
// (Universal Architectural Test #4) requires the full path, not just QUEUED->COMPLETED.
export const agentJobAttemptsTable = pgTable("agent_job_attempts", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  fromState: text("from_state").notNull(),
  toState: text("to_state").notNull(),
  cause: text("cause"),
  startedAt: timestamp("started_at").defaultNow(),
  endedAt: timestamp("ended_at"),
});

// ─── Handoffs (spec: "Canonical Handoff Envelope") ───────────────────────────

export const agentHandoffsTable = pgTable("agent_handoffs", {
  id: serial("id").primaryKey(),
  correlationId: text("correlation_id").notNull(),
  sendingAgentId: text("sending_agent_id").notNull(),
  receivingAgentId: text("receiving_agent_id").notNull(),
  organizationId: integer("organization_id"),
  siteIds: integer("site_ids").array().notNull().default(sql`'{}'::integer[]`),
  authorizedUserId: integer("authorized_user_id"),
  sourceIds: jsonb("source_ids").notNull().default(sql`'[]'::jsonb`),
  dataClassification: text("data_classification"),
  state: text("state").notNull(),
  completedActions: jsonb("completed_actions").notNull().default(sql`'[]'::jsonb`),
  verificationStatus: text("verification_status").notNull().default("pending"),
  unresolvedItems: jsonb("unresolved_items").notNull().default(sql`'[]'::jsonb`),
  deadline: timestamp("deadline"),
  requiredNextAction: text("required_next_action").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Evidence and audit log ───────────────────────────────────────────────────

export const agentActionLogsTable = pgTable("agent_action_logs", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id"),
  agentId: text("agent_id").notNull(),
  correlationId: text("correlation_id").notNull(),
  action: text("action").notNull(), // audit event name, e.g. "lead.qualified" (see each agent's "Required Audit Events")
  organizationId: integer("organization_id"),
  siteIds: integer("site_ids").array().notNull().default(sql`'{}'::integer[]`),
  input: jsonb("input"),
  output: jsonb("output"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const agentVerificationResultsTable = pgTable("agent_verification_results", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull(),
  agentId: text("agent_id").notNull(),
  gateName: text("gate_name").notNull(),
  passed: boolean("passed").notNull(),
  evidence: jsonb("evidence"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Founder exception queue (spec: "Founder Exception Record") ─────────────

export const agentExceptionsTable = pgTable("agent_exceptions", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id"),
  agentId: text("agent_id").notNull(),
  correlationId: text("correlation_id").notNull(),
  severity: text("severity").notNull(),
  organizationId: integer("organization_id"),
  siteIds: integer("site_ids").array().notNull().default(sql`'{}'::integer[]`),
  whatHappened: text("what_happened").notNull(),
  evidence: jsonb("evidence"),
  customerImpact: text("customer_impact"),
  operationalImpact: text("operational_impact"),
  attemptedActions: jsonb("attempted_actions").notNull().default(sql`'[]'::jsonb`),
  whyRecoveryStopped: text("why_recovery_stopped"),
  availableOptions: jsonb("available_options").notNull().default(sql`'[]'::jsonb`),
  recommendedOption: text("recommended_option"),
  decisionRequested: text("decision_requested").notNull(),
  responseDeadline: timestamp("response_deadline"),
  status: text("status").notNull().default("open"), // open | resolved | dismissed
  founderDecision: text("founder_decision"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AgentException = typeof agentExceptionsTable.$inferSelect;
