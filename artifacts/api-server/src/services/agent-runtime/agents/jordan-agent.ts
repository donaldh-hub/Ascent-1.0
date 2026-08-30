/**
 * Jordan — customer-facing agent identity within the shared runtime
 * (Build Sequence step 6, grouped with Customer-Support because both
 * expose the system to customers). The actual conversation logic (tool-
 * calling loop, grounding rule, system prompt) already exists and is
 * UNTOUCHED here — jordan-chat-service.ts / jordan-tools.ts (PR #7). This
 * file wraps that existing logic with the agent runtime's audit trail and
 * exception queue, the same "wrap, don't shadow" pattern as Data-
 * Ingestion wrapping importWorkOrderRows.
 *
 * New in this increment:
 * - jordan.question_received / answer.generated audit events for every
 *   message, via the shared agent_action_logs table.
 * - "Capture questions Jordan could not answer" (job description, Core
 *   Responsibility 8): when the tool-calling loop exhausts its turn cap
 *   and falls back to its generic "I'm having trouble narrowing this
 *   down..." response, that's now logged as a low-severity knowledge-gap
 *   exception instead of just vanishing after being shown to the user
 *   once — a real signal for "what should Jordan's tool coverage grow
 *   into next," not an incident.
 * - Real enforcement of Intelligence-Quality's release decisions inside
 *   Jordan's own tools (see quality-enforcement.ts, wired into
 *   jordan-tools.ts directly) — the first place that gate actually holds
 *   anything back, closing part of the "recorded but not enforced" gap
 *   flagged in PR #13's Intelligence-Quality agent.
 *
 * A missing ANTHROPIC_API_KEY is not a transient failure — retrying won't
 * configure it — so it's translated to FAILED_FINAL immediately (no
 * retry budget spent) and re-thrown as the original JordanNotConfiguredError
 * so the existing POST /coach/chat route's 503 handling keeps working
 * completely unchanged.
 */
import type { AgentJob } from "@workspace/db/schema";
import { registerAgent, runAgentInline, type AgentHandlerResult } from "../orchestrator.js";
import { logAgentAction, raiseException } from "../audit.js";
import { sendJordanMessage, JordanNotConfiguredError } from "../../jordan-chat-service.js";

export const JORDAN_AGENT_ID = "jordan_coach";

const KNOWLEDGE_GAP_FALLBACK = "I'm having trouble narrowing this down — could you rephrase or be more specific about which site?";

interface JordanJobPayload {
  userId: number;
  accessibleSiteIds: number[];
  conversationId?: number;
  message: string;
}

async function handleJordanMessage(job: AgentJob): Promise<AgentHandlerResult> {
  const payload = job.payload as JordanJobPayload;

  await logAgentAction({
    jobId: job.id,
    agentId: JORDAN_AGENT_ID,
    correlationId: job.correlationId,
    action: "jordan.question_received",
    organizationId: job.organizationId ?? undefined,
    siteIds: payload.accessibleSiteIds,
    input: { message: payload.message, conversationId: payload.conversationId ?? null },
  });

  let result: { conversationId: number; reply: string };
  try {
    result = await sendJordanMessage({
      userId: payload.userId,
      accessibleSiteIds: payload.accessibleSiteIds,
      conversationId: payload.conversationId,
      message: payload.message,
    });
  } catch (err) {
    if (err instanceof JordanNotConfiguredError) {
      // Not transient — no retry budget spent on a config problem.
      return { outcome: "failed_final", error: err.message };
    }
    throw err;
  }

  await logAgentAction({
    jobId: job.id,
    agentId: JORDAN_AGENT_ID,
    correlationId: job.correlationId,
    action: "answer.generated",
    organizationId: job.organizationId ?? undefined,
    siteIds: payload.accessibleSiteIds,
    output: { conversationId: result.conversationId },
  });

  if (result.reply === KNOWLEDGE_GAP_FALLBACK) {
    await raiseException({
      jobId: job.id,
      agentId: JORDAN_AGENT_ID,
      correlationId: job.correlationId,
      severity: "low",
      organizationId: job.organizationId ?? undefined,
      siteIds: payload.accessibleSiteIds,
      whatHappened: `Jordan could not answer: "${payload.message}"`,
      evidence: { conversationId: result.conversationId, message: payload.message },
      attemptedActions: ["Ran the tool-calling loop to its turn cap without reaching a final answer"],
      whyRecoveryStopped: "This is a knowledge/tool-coverage gap, not a transient failure — retrying won't change the outcome for this exact question.",
      availableOptions: ["Review whether a new Jordan tool is needed to cover this kind of question", "No action needed if this was a one-off ambiguous question"],
      decisionRequested: "Review this as a potential knowledge-coverage gap for Jordan's tools.",
    });
  }

  return { outcome: "completed", result };
}

export async function registerJordanAgent(): Promise<void> {
  await registerAgent(
    JORDAN_AGENT_ID,
    "Jordan",
    "Customer-facing maintenance intelligence coach. Explains findings, retrieves supporting records, and helps leaders see what deserves attention next — never invents a fact outside what its tools actually returned.",
    handleJordanMessage,
  );
}

export class JordanJobNotCompletedError extends Error {
  constructor(
    public readonly jobState: string,
    public readonly lastError?: string,
  ) {
    super(`Jordan's job did not complete synchronously (state: ${jobState}${lastError ? `, error: ${lastError}` : ""}).`);
    this.name = "JordanJobNotCompletedError";
  }
}

/**
 * Drop-in replacement for calling sendJordanMessage() directly — same
 * inputs/outputs, routed through the agent runtime's job tracking, audit
 * log, and knowledge-gap capture. POST /coach/chat's existing
 * JordanNotConfiguredError handling keeps working unchanged (see class
 * doc comment above for how that's preserved through the job wrapper).
 */
export async function runJordanMessageInline(payload: JordanJobPayload): Promise<{ conversationId: number; reply: string }> {
  const job = await runAgentInline({
    agentId: JORDAN_AGENT_ID,
    triggerEvent: "question_received",
    payload,
    authorizedUserId: payload.userId,
    siteIds: payload.accessibleSiteIds,
  });

  if (job.state === "FAILED_FINAL" && job.lastError?.includes("Jordan's conversational mode isn't configured")) {
    throw new JordanNotConfiguredError();
  }
  if (job.state !== "COMPLETED") {
    throw new JordanJobNotCompletedError(job.state, job.lastError ?? undefined);
  }
  return job.result as { conversationId: number; reply: string };
}
