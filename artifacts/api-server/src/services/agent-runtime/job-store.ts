/**
 * Agent Job Store (Build Sequence step 1) — Postgres-backed, in-process
 * polling. agent_jobs IS the queue; there is no separate broker. This app
 * has no queue infrastructure today and deploys as a single process, so
 * this is the smallest thing that actually implements the spec's
 * Canonical Agent Job States without adding new infra (confirmed
 * 2026-08-28). The orchestrator (orchestrator.ts) is the only thing that
 * calls claimDueJobs/transitionJob — agent code should go through
 * runAgentJob's handler contract, not touch job rows directly.
 */
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { agentJobsTable, agentJobAttemptsTable, type AgentJob, type AgentJobState } from "@workspace/db/schema";
import { and, eq, inArray, lte } from "drizzle-orm";

const DUE_STATES: AgentJobState[] = ["QUEUED", "RETRY_SCHEDULED"];

export interface EnqueueJobInput {
  agentId: string;
  triggerEvent: string;
  payload?: unknown;
  organizationId?: number;
  siteIds?: number[];
  authorizedUserId?: number;
  correlationId?: string;
  maxAttempts?: number;
  /** Delay first execution — e.g. a scheduled retry. Defaults to now. */
  runAt?: Date;
}

export async function enqueueJob(input: EnqueueJobInput): Promise<AgentJob> {
  const [row] = await db
    .insert(agentJobsTable)
    .values({
      correlationId: input.correlationId ?? randomUUID(),
      agentId: input.agentId,
      triggerEvent: input.triggerEvent,
      payload: (input.payload ?? {}) as object,
      organizationId: input.organizationId,
      siteIds: input.siteIds ?? [],
      authorizedUserId: input.authorizedUserId,
      maxAttempts: input.maxAttempts ?? 3,
      nextRunAt: input.runAt ?? new Date(),
    })
    .returning();
  return row;
}

/** Every job currently due to run, oldest first — what the orchestrator's poll tick processes. */
export async function claimDueJobs(): Promise<AgentJob[]> {
  return db
    .select()
    .from(agentJobsTable)
    .where(and(inArray(agentJobsTable.state, DUE_STATES), lte(agentJobsTable.nextRunAt, new Date())))
    .orderBy(agentJobsTable.id);
}

export async function transitionJob(
  job: AgentJob,
  toState: AgentJobState,
  patch: Partial<Pick<AgentJob, "attempt" | "nextRunAt" | "lastError" | "result">> = {},
  cause?: string,
): Promise<AgentJob> {
  const [updated] = await db
    .update(agentJobsTable)
    .set({ state: toState, updatedAt: new Date(), ...patch })
    .where(eq(agentJobsTable.id, job.id))
    .returning();

  await db.insert(agentJobAttemptsTable).values({
    jobId: job.id,
    attemptNumber: patch.attempt ?? job.attempt,
    fromState: job.state,
    toState,
    cause,
    endedAt: ["COMPLETED", "FAILED_FINAL", "ESCALATED", "BLOCKED_BY_POLICY", "BLOCKED_BY_QUALITY", "QUARANTINED"].includes(toState)
      ? new Date()
      : undefined,
  });

  return updated;
}

export async function getJob(jobId: number): Promise<AgentJob | undefined> {
  const [row] = await db.select().from(agentJobsTable).where(eq(agentJobsTable.id, jobId)).limit(1);
  return row;
}
