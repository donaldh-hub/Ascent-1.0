/**
 * Chief Operating Agent — Build Sequence step 9, the last department
 * agent and the one the Founder Control Center is built around. Per the
 * job description: "Operate Ascent's agent-run company as a coordinated
 * system... bring Donald only verified alerts, genuine exceptions, and
 * strategic decisions requiring his authority."
 *
 * Scope of THIS increment, stated plainly:
 * - "Reject incomplete escalations" is already structurally enforced,
 *   not something to rebuild here: raiseException()'s TypeScript type
 *   (audit.ts) requires whatHappened/evidence/attemptedActions/
 *   whyRecoveryStopped/availableOptions/decisionRequested at every call
 *   site across every agent in this build. There is no path to an
 *   incomplete exception today.
 * - "Consolidate related events into one operating incident" IS built
 *   here for real: exceptions from the same agent, not yet linked to an
 *   incident, get grouped into an agent_incidents row on a recurring
 *   pass — real grouping over real data, not a fabricated summary.
 * - Operating health and the founder briefing are computed LIVE from
 *   existing tables every time they're requested (see the two exported
 *   functions below) rather than stored snapshots — see
 *   chief_operating.ts's header for why.
 * - "Coordinate recovery," "reassign stalled work," "route Donald's
 *   decision back as a controlled instruction" are NOT built — this
 *   deployment's agents already retry/recover autonomously via the
 *   orchestrator's own backoff logic (PR #13), and there is no second,
 *   separate recovery-coordination layer to build without duplicating
 *   that. Recording Donald's decision (founder_decisions) and resolving
 *   the exception it answers IS built — see recordFounderDecision().
 */
import { db } from "@workspace/db";
import {
  agentJobsTable,
  agentExceptionsTable,
  agentIncidentsTable,
  founderDecisionsTable,
  qualityReleaseDecisionsTable,
  supportCasesTable,
  leadsTable,
  type AgentJob,
  type AgentException,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { registerAgent, type AgentHandlerResult } from "../orchestrator.js";
import { logAgentAction, listOpenExceptions, resolveException } from "../audit.js";
import { enqueueJob, hasPendingJob } from "../job-store.js";

export const CHIEF_OPERATING_AGENT_ID = "chief_operating_agent";

const CONSOLIDATION_INTERVAL_MS = 10 * 60_000; // recheck every 10 minutes
const MIN_CLUSTER_SIZE = 2; // a single exception isn't a "cluster" worth its own incident

async function handleConsolidation(job: AgentJob): Promise<AgentHandlerResult> {
  const openExceptions = await listOpenExceptions();
  const openIncidents = await db.select().from(agentIncidentsTable).where(eq(agentIncidentsTable.status, "open"));
  const alreadyLinked = new Set(openIncidents.flatMap((i) => i.exceptionIds));
  const unlinked = openExceptions.filter((e) => !alreadyLinked.has(e.id));

  const byAgent = new Map<string, AgentException[]>();
  for (const e of unlinked) {
    const list = byAgent.get(e.agentId) ?? [];
    list.push(e);
    byAgent.set(e.agentId, list);
  }

  const severityRank = ["critical", "high", "medium", "low"];
  let incidentsCreated = 0;

  for (const [agentId, exceptions] of byAgent.entries()) {
    if (exceptions.length < MIN_CLUSTER_SIZE) continue;
    const worstSeverity = severityRank.find((s) => exceptions.some((e) => e.severity === s)) ?? "low";
    const [incident] = await db
      .insert(agentIncidentsTable)
      .values({
        title: `${exceptions.length} related exceptions from ${agentId}`,
        severity: worstSeverity,
        exceptionIds: exceptions.map((e) => e.id),
        agentIds: [agentId],
      })
      .returning();
    incidentsCreated++;
    await logAgentAction({
      jobId: job.id,
      agentId: CHIEF_OPERATING_AGENT_ID,
      correlationId: job.correlationId,
      action: "coa.incident_consolidated",
      output: { incidentId: incident.id, agentId, exceptionCount: exceptions.length },
    });
  }

  await logAgentAction({
    jobId: job.id,
    agentId: CHIEF_OPERATING_AGENT_ID,
    correlationId: job.correlationId,
    action: "coa.health_updated",
    output: { openExceptionCount: openExceptions.length, incidentsCreated },
  });

  await enqueueJob({
    agentId: CHIEF_OPERATING_AGENT_ID,
    triggerEvent: "scheduled_consolidation",
    payload: {},
    runAt: new Date(Date.now() + CONSOLIDATION_INTERVAL_MS),
  });

  return { outcome: "completed", result: { openExceptionCount: openExceptions.length, incidentsCreated } };
}

export async function registerChiefOperatingAgent(): Promise<void> {
  await registerAgent(
    CHIEF_OPERATING_AGENT_ID,
    "Chief Operating Agent",
    "Consolidates related exceptions into incidents and maintains the Founder Control Center's live operating-health view. Does not coordinate recovery (agents already self-recover via the orchestrator) or act on Donald's behalf.",
    handleConsolidation,
  );
}

export async function scheduleInitialConsolidation(): Promise<void> {
  if (await hasPendingJob(CHIEF_OPERATING_AGENT_ID)) return;
  await enqueueJob({ agentId: CHIEF_OPERATING_AGENT_ID, triggerEvent: "scheduled_consolidation", payload: {} });
}

// ─── Live operating-health snapshot (spec: "Minimum Control Center") ────────

export interface OperatingHealthSnapshot {
  jobsByState: Record<string, number>;
  openExceptionsBySeverity: Record<string, number>;
  openExceptionsByAgent: Record<string, number>;
  qualityDecisions: { released: number; blocked: number };
  supportCasesByStatus: Record<string, number>;
  leadsByStatus: Record<string, number>;
  /** Fraction of terminal jobs that needed a human decision rather than completing cleanly. */
  manualInterventionRate: number;
  generatedAt: string;
}

const MANUAL_INTERVENTION_STATES = ["FAILED_FINAL", "ESCALATED", "BLOCKED_BY_POLICY", "BLOCKED_BY_QUALITY", "QUARANTINED"];
const TERMINAL_STATES = ["COMPLETED", ...MANUAL_INTERVENTION_STATES];

export async function getOperatingHealth(): Promise<OperatingHealthSnapshot> {
  const [jobs, openExceptions, decisions, supportCases, leads] = await Promise.all([
    db.select({ state: agentJobsTable.state }).from(agentJobsTable),
    listOpenExceptions(),
    db.select({ decision: qualityReleaseDecisionsTable.decision }).from(qualityReleaseDecisionsTable),
    db.select({ status: supportCasesTable.status }).from(supportCasesTable),
    db.select({ status: leadsTable.status }).from(leadsTable),
  ]);

  const jobsByState: Record<string, number> = {};
  for (const j of jobs) jobsByState[j.state] = (jobsByState[j.state] ?? 0) + 1;

  const openExceptionsBySeverity: Record<string, number> = {};
  const openExceptionsByAgent: Record<string, number> = {};
  for (const e of openExceptions) {
    openExceptionsBySeverity[e.severity] = (openExceptionsBySeverity[e.severity] ?? 0) + 1;
    openExceptionsByAgent[e.agentId] = (openExceptionsByAgent[e.agentId] ?? 0) + 1;
  }

  const qualityDecisions = {
    released: decisions.filter((d) => d.decision === "released").length,
    blocked: decisions.filter((d) => d.decision === "blocked").length,
  };

  const supportCasesByStatus: Record<string, number> = {};
  for (const c of supportCases) supportCasesByStatus[c.status] = (supportCasesByStatus[c.status] ?? 0) + 1;

  const leadsByStatus: Record<string, number> = {};
  for (const l of leads) leadsByStatus[l.status] = (leadsByStatus[l.status] ?? 0) + 1;

  const terminalJobs = jobs.filter((j) => TERMINAL_STATES.includes(j.state));
  const manualJobs = jobs.filter((j) => MANUAL_INTERVENTION_STATES.includes(j.state));
  const manualInterventionRate = terminalJobs.length > 0 ? manualJobs.length / terminalJobs.length : 0;

  return {
    jobsByState,
    openExceptionsBySeverity,
    openExceptionsByAgent,
    qualityDecisions,
    supportCasesByStatus,
    leadsByStatus,
    manualInterventionRate,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Founder briefing (spec: "Founder Alert Format") ────────────────────────

export interface FounderAlert {
  exceptionId: number;
  agentId: string;
  severity: string;
  whatHappened: string;
  whyItMatters: string;
  whatAgentsAlreadyDid: string[];
  optionsAvailable: string[];
  recommendation: string | null;
  decisionRequested: string;
  deadline: string | null;
}

function toFounderAlert(e: AgentException): FounderAlert {
  return {
    exceptionId: e.id,
    agentId: e.agentId,
    severity: e.severity,
    whatHappened: e.whatHappened,
    whyItMatters: [e.customerImpact, e.operationalImpact].filter(Boolean).join(" ") || `Severity: ${e.severity}`,
    whatAgentsAlreadyDid: Array.isArray(e.attemptedActions) ? (e.attemptedActions as string[]) : [],
    optionsAvailable: Array.isArray(e.availableOptions) ? (e.availableOptions as string[]) : [],
    recommendation: e.recommendedOption ?? null,
    decisionRequested: e.decisionRequested,
    deadline: e.responseDeadline ? new Date(e.responseDeadline).toISOString() : null,
  };
}

/**
 * Every field here traces directly to a real agent_exceptions row raised
 * by one of the nine department agents — the briefing is a real
 * aggregation of real evidence, never generated text standing in for it.
 */
export async function getFounderBriefing(): Promise<{ urgent: FounderAlert[]; scheduled: FounderAlert[] }> {
  const openExceptions = await listOpenExceptions();
  const urgent = openExceptions.filter((e) => e.severity === "critical" || e.severity === "high").map(toFounderAlert);
  const scheduled = openExceptions.filter((e) => e.severity === "medium" || e.severity === "low").map(toFounderAlert);
  return { urgent, scheduled };
}

/**
 * Records Donald's decision on an exception and closes it out —
 * resolveException() already exists (audit.ts); this just also keeps a
 * durable founder_decisions record distinct from the exception's own
 * founderDecision text field, matching the spec's minimum tables.
 */
export async function recordFounderDecision(input: {
  exceptionId: number;
  decision: string;
  decidedByUserId?: number;
}) {
  const [record] = await db
    .insert(founderDecisionsTable)
    .values({ exceptionId: input.exceptionId, decision: input.decision, decidedByUserId: input.decidedByUserId })
    .returning();
  const exception = await resolveException(input.exceptionId, input.decision);
  return { record, exception };
}
