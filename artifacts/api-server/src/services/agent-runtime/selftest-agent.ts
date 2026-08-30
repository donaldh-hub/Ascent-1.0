/**
 * Platform self-test agent — NOT one of the nine department agents from
 * "Ascent 1.0 — Agent Job Descriptions and Operating Authority." It exists
 * solely to prove the shared runtime (job states, retry/backoff, policy
 * enforcement, audit log, founder exception queue) actually works
 * end-to-end before any real business agent is built on top of it. It
 * never runs unless a job is explicitly enqueued for it — safe to leave
 * registered permanently as a runtime health check.
 */
import type { AgentJob } from "@workspace/db/schema";
import { registerAgent, type AgentHandlerResult } from "./orchestrator.js";
import { assertToolAllowed } from "./policy.js";

export const SELFTEST_AGENT_ID = "platform_selftest_agent";

export type SelfTestMode = "succeed" | "fail_then_succeed" | "always_fail" | "policy_violation";

interface SelfTestPayload {
  mode: SelfTestMode;
}

async function handleSelfTest(job: AgentJob): Promise<AgentHandlerResult> {
  const payload = job.payload as SelfTestPayload;

  switch (payload.mode) {
    case "policy_violation":
      // Deliberately calls a tool this agent was never granted, to prove
      // assertToolAllowed actually blocks the job (-> BLOCKED_BY_POLICY)
      // instead of silently letting it through.
      await assertToolAllowed(SELFTEST_AGENT_ID, "tool_never_granted");
      return { outcome: "completed" }; // unreachable if policy enforcement works

    case "always_fail":
      return { outcome: "retry", error: "Deliberate self-test failure (always_fail mode)." };

    case "fail_then_succeed":
      // job.attempt is the attempt number the orchestrator just set this
      // run to (1-indexed) — fails the first two attempts, succeeds on the third.
      if (job.attempt < 3) {
        return { outcome: "retry", error: `Deliberate self-test failure on attempt ${job.attempt}.` };
      }
      return { outcome: "completed", result: { attemptsNeeded: job.attempt } };

    case "succeed":
    default:
      return { outcome: "completed", result: { echoedPayload: payload } };
  }
}

export async function registerSelfTestAgent(): Promise<void> {
  await registerAgent(
    SELFTEST_AGENT_ID,
    "Platform Self-Test",
    "Proves the shared agent runtime (states, retries, policy, audit, exceptions) works end-to-end. Not a business agent — never runs unless a job is explicitly enqueued for it.",
    handleSelfTest,
  );
}
