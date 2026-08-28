/**
 * Infrastructure Agent — Build Sequence step 7 (grouped with Security
 * because both carry blocking/containment authority). Per the job
 * description: "Keep Ascent available, recoverable, cost-aware, and
 * scalable by continuously monitoring the technical systems."
 *
 * Scope of THIS increment, stated plainly: this deployment has no real
 * external monitoring, cost telemetry, backup verifier, or deployment/
 * scaling API to plug into — building "backup verification" or "safe
 * scaling" against nothing would be exactly the "placeholder logic
 * passed off as working" the spec forbids. What genuinely exists to
 * monitor, right now, is the agent runtime itself (PR #13) — so this
 * agent watches THAT: stalled jobs (stuck in RUNNING far longer than any
 * handler should take — usually a hung handler), a growing backlog
 * (jobs sitting QUEUED/RETRY_SCHEDULED well past their due time — the
 * poll loop isn't keeping up or has stopped), and repeated-failure
 * clusters (the same agent raising multiple exceptions within an hour —
 * a systemic problem, not an isolated one-off). All real, all queryable
 * from data that already exists, none of it fabricated.
 *
 * Runs as a self-rescheduling recurring job (enqueues its own next run on
 * completion) rather than adding a second scheduling mechanism next to
 * the orchestrator's existing poll loop. Known limitation, stated
 * honestly: this means agent_jobs grows by one health-check row every
 * interval forever — fine for now, but real job-table retention/
 * archival is a genuine follow-up this doesn't attempt to solve.
 */
import { db } from "@workspace/db";
import { agentJobsTable, agentExceptionsTable, type AgentJob } from "@workspace/db/schema";
import { eq, and, inArray, lt, gte } from "drizzle-orm";
import { registerAgent, type AgentHandlerResult } from "../orchestrator.js";
import { logAgentAction, raiseException } from "../audit.js";
import { enqueueJob, hasPendingJob } from "../job-store.js";

export const INFRASTRUCTURE_AGENT_ID = "infrastructure_agent";

const HEALTH_CHECK_INTERVAL_MS = 5 * 60_000; // recheck every 5 minutes
const STALLED_JOB_THRESHOLD_MS = 15 * 60_000; // RUNNING/overdue longer than this is an anomaly
const EXCEPTION_CLUSTER_THRESHOLD = 3; // same agent raising >= this many exceptions in the lookback window
const CLUSTER_LOOKBACK_MS = 60 * 60_000;

async function handleHealthCheck(job: AgentJob): Promise<AgentHandlerResult> {
  const stallCutoff = new Date(Date.now() - STALLED_JOB_THRESHOLD_MS);

  const stalledJobs = await db
    .select()
    .from(agentJobsTable)
    .where(and(eq(agentJobsTable.state, "RUNNING"), lt(agentJobsTable.updatedAt, stallCutoff)));

  const backlogJobs = await db
    .select()
    .from(agentJobsTable)
    .where(and(inArray(agentJobsTable.state, ["QUEUED", "RETRY_SCHEDULED"]), lt(agentJobsTable.nextRunAt, stallCutoff)));

  const recentExceptions = await db
    .select()
    .from(agentExceptionsTable)
    .where(gte(agentExceptionsTable.createdAt, new Date(Date.now() - CLUSTER_LOOKBACK_MS)));

  const exceptionCountsByAgent = new Map<string, number>();
  for (const e of recentExceptions) {
    exceptionCountsByAgent.set(e.agentId, (exceptionCountsByAgent.get(e.agentId) ?? 0) + 1);
  }
  const clusters = [...exceptionCountsByAgent.entries()]
    .filter(([, count]) => count >= EXCEPTION_CLUSTER_THRESHOLD)
    .map(([agentId, count]) => ({ agentId, count }));

  await logAgentAction({
    jobId: job.id,
    agentId: INFRASTRUCTURE_AGENT_ID,
    correlationId: job.correlationId,
    action: "health.anomaly_detected",
    output: { stalledJobCount: stalledJobs.length, backlogCount: backlogJobs.length, clusters },
  });

  if (stalledJobs.length > 0 || clusters.length > 0) {
    await raiseException({
      jobId: job.id,
      agentId: INFRASTRUCTURE_AGENT_ID,
      correlationId: job.correlationId,
      severity: clusters.length > 0 ? "high" : "medium",
      whatHappened: `Agent-runtime health check found ${stalledJobs.length} stalled job(s) and ${clusters.length} repeated-failure cluster(s) in the last hour.`,
      evidence: {
        stalledJobs: stalledJobs.map((j) => ({ id: j.id, agentId: j.agentId, updatedAt: j.updatedAt })),
        backlogCount: backlogJobs.length,
        clusters,
      },
      attemptedActions: [
        "Queried agent_jobs for RUNNING jobs past the stall threshold",
        "Queried agent_exceptions for repeated-failure clusters in the last hour",
      ],
      whyRecoveryStopped: "A stalled handler or a repeated-failure pattern needs investigation of the specific agent involved — not something Infrastructure can safely retry or fix on its own.",
      availableOptions: [
        ...stalledJobs.map((j) => `Investigate stalled job ${j.id} (agent: ${j.agentId})`),
        ...clusters.map((c) => `Investigate the recurring failure cause for ${c.agentId} (${c.count} exceptions in the last hour)`),
      ],
      decisionRequested: "Review the agent-runtime health anomaly.",
    });
  }

  // Recurring health check — self-reschedule regardless of this run's
  // outcome, rather than adding a second scheduling mechanism.
  await enqueueJob({
    agentId: INFRASTRUCTURE_AGENT_ID,
    triggerEvent: "scheduled_health_check",
    payload: {},
    runAt: new Date(Date.now() + HEALTH_CHECK_INTERVAL_MS),
  });

  return {
    outcome: "completed",
    result: { stalledJobCount: stalledJobs.length, backlogCount: backlogJobs.length, clusterCount: clusters.length },
  };
}

export async function registerInfrastructureAgent(): Promise<void> {
  await registerAgent(
    INFRASTRUCTURE_AGENT_ID,
    "Infrastructure Agent",
    "Monitors the agent runtime's own health — stalled jobs, backlog, and repeated-failure clusters — since no external monitoring/cost/backup infrastructure exists to plug into yet.",
    handleHealthCheck,
  );
}

/**
 * Enqueues the first scheduled health check — call once at server
 * startup, after registerInfrastructureAgent(). Idempotent: a restart
 * while a health-check chain is already in flight (queued, retrying, or
 * running) does not spawn a second parallel chain.
 */
export async function scheduleInitialHealthCheck(): Promise<void> {
  if (await hasPendingJob(INFRASTRUCTURE_AGENT_ID)) return;
  await enqueueJob({ agentId: INFRASTRUCTURE_AGENT_ID, triggerEvent: "scheduled_health_check", payload: {} });
}
