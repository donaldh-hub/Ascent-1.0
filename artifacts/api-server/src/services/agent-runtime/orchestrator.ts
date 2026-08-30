/**
 * Agent Orchestrator (Build Sequence step 1) — the shared runtime every
 * department agent executes under. Handler functions register themselves
 * here at server startup; the orchestrator owns job claiming, state
 * transitions, retry/backoff, and the audit trail. An agent module never
 * writes to agent_jobs directly — it returns an AgentHandlerResult and
 * lets the orchestrator translate that into the canonical state machine.
 */
import { logger } from "../../lib/logger.js";
import { db } from "@workspace/db";
import { agentDefinitionsTable, type AgentJob } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { claimDueJobs, transitionJob, enqueueJob, type EnqueueJobInput } from "./job-store.js";
import { logAgentAction, raiseException } from "./audit.js";
import { PolicyViolationError } from "./policy.js";

export type AgentHandlerResult =
  | { outcome: "completed"; result?: unknown }
  | { outcome: "retry"; error: string }
  | { outcome: "failed_final"; error: string }
  | { outcome: "escalated"; error: string };

export type AgentHandler = (job: AgentJob) => Promise<AgentHandlerResult>;

interface RegisteredAgent {
  name: string;
  mission: string;
  handler: AgentHandler;
}

const registry = new Map<string, RegisteredAgent>();

/**
 * Registers an agent's handler in this process AND upserts its
 * agent_definitions row (idempotent — safe to call on every server
 * startup). An agentId with no registered handler can still have jobs
 * enqueued for it (e.g. by another agent that expects it to exist soon),
 * but those jobs will fail_final with a clear "no handler" error rather
 * than hang forever.
 */
export async function registerAgent(agentId: string, name: string, mission: string, handler: AgentHandler): Promise<void> {
  registry.set(agentId, { name, mission, handler });
  const existing = await db.select().from(agentDefinitionsTable).where(eq(agentDefinitionsTable.agentId, agentId)).limit(1);
  if (existing[0]) {
    await db.update(agentDefinitionsTable).set({ name, mission }).where(eq(agentDefinitionsTable.agentId, agentId));
  } else {
    await db.insert(agentDefinitionsTable).values({ agentId, name, mission });
  }
}

/** Exponential backoff, capped at 10 minutes — same shape as any ordinary retry queue. */
function backoffMs(attempt: number): number {
  return Math.min(10 * 60_000, 30_000 * 2 ** attempt);
}

async function runOne(job: AgentJob): Promise<AgentJob> {
  const agent = registry.get(job.agentId);
  const nextAttempt = job.attempt + 1;

  if (!agent) {
    return transitionJob(job, "FAILED_FINAL", { attempt: nextAttempt, lastError: `No handler registered for agent "${job.agentId}"` }, "no handler registered");
  }

  const running = await transitionJob(job, "RUNNING", { attempt: nextAttempt }, "orchestrator claimed job");

  try {
    const result = await agent.handler(running);

    switch (result.outcome) {
      case "completed": {
        const completed = await transitionJob(running, "COMPLETED", { result: result.result as object | undefined }, "handler completed");
        await logAgentAction({
          jobId: running.id,
          agentId: running.agentId,
          correlationId: running.correlationId,
          action: `${running.agentId}.job_completed`,
          organizationId: running.organizationId ?? undefined,
          siteIds: running.siteIds,
          output: result.result,
        });
        return completed;
      }
      case "retry": {
        if (nextAttempt >= running.maxAttempts) {
          return failFinal(running, result.error);
        }
        return transitionJob(
          running,
          "RETRY_SCHEDULED",
          { lastError: result.error, nextRunAt: new Date(Date.now() + backoffMs(nextAttempt)) },
          result.error,
        );
      }
      case "failed_final": {
        return failFinal(running, result.error);
      }
      case "escalated": {
        return transitionJob(running, "ESCALATED", { lastError: result.error }, result.error);
      }
    }
  } catch (err) {
    if (err instanceof PolicyViolationError) {
      return transitionJob(running, "BLOCKED_BY_POLICY", { lastError: err.message }, err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    if (nextAttempt >= running.maxAttempts) {
      return failFinal(running, message);
    }
    return transitionJob(running, "RETRY_SCHEDULED", { lastError: message, nextRunAt: new Date(Date.now() + backoffMs(nextAttempt)) }, message);
  }
}

/**
 * A job that exhausted its retries never just disappears — per "A failed
 * action creates a recoverable state, not a silent dead end," reaching
 * FAILED_FINAL always raises a founder exception so the Chief Operating
 * Agent (once built) has something concrete to consolidate and rank,
 * instead of the failure only existing as a row nobody is looking at.
 */
async function failFinal(job: AgentJob, error: string): Promise<AgentJob> {
  const failed = await transitionJob(job, "FAILED_FINAL", { lastError: error }, error);
  await raiseException({
    jobId: job.id,
    agentId: job.agentId,
    correlationId: job.correlationId,
    severity: "medium",
    organizationId: job.organizationId ?? undefined,
    siteIds: job.siteIds,
    whatHappened: `Job ${job.id} (${job.triggerEvent}) failed after ${job.maxAttempts} attempts: ${error}`,
    evidence: { jobId: job.id, triggerEvent: job.triggerEvent, payload: job.payload },
    attemptedActions: [`${job.maxAttempts} execution attempts with exponential backoff`],
    whyRecoveryStopped: `Retry budget (${job.maxAttempts} attempts) exhausted.`,
    availableOptions: ["Re-enqueue the job after investigating the error", "Dismiss if the underlying condition is no longer relevant"],
    decisionRequested: "Re-enqueue or dismiss this failed job.",
  });
  return failed;
}

/**
 * Runs an agent job to completion synchronously within the caller's own
 * request, instead of waiting for the poll loop — for callers that need
 * the result immediately (e.g. an HTTP upload route that has always
 * returned its import result in the same response). Still goes through
 * the exact same job row, state transitions, audit log, and exception
 * queue as an async job; the only difference is WHEN it runs, not HOW.
 *
 * If the handler's first attempt doesn't complete (a transient "retry"
 * outcome, or a policy block), this does NOT block waiting out the
 * backoff delay — it returns the job in whatever state it landed in
 * (e.g. RETRY_SCHEDULED), and the background poll loop picks up any
 * remaining attempts from there. Callers must check job.state, not
 * assume COMPLETED.
 */
export async function runAgentInline(input: EnqueueJobInput): Promise<AgentJob> {
  const job = await enqueueJob(input);
  return runOne(job);
}

let ticking = false;

export async function runDueJobs(): Promise<{ processed: number }> {
  if (ticking) return { processed: 0 }; // a previous tick is still running a long job — never overlap
  ticking = true;
  try {
    const due = await claimDueJobs();
    for (const job of due) {
      await runOne(job);
    }
    return { processed: due.length };
  } finally {
    ticking = false;
  }
}

let intervalHandle: ReturnType<typeof setInterval> | undefined;

/** Starts the in-process poll loop. Call once at server startup. */
export function startOrchestratorLoop(intervalMs = 10_000): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    runDueJobs().catch((err) => logger.error({ err }, "Agent orchestrator tick failed"));
  }, intervalMs);
}

export function stopOrchestratorLoop(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = undefined;
  }
}
