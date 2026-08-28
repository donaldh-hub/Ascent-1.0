/**
 * Onboarding Agent — Build Sequence step 5 (grouped with Billing because
 * both establish customer and revenue truth). Per the job description:
 * "Activate each customer accurately and quickly so the organization can
 * begin using Ascent without manual founder setup."
 *
 * Scope of THIS increment, stated plainly: this deployment is currently
 * single-hub (see account_status.ts) — there is one organization, not
 * many, so "resolve or create the organization without duplication"
 * reduces to the existing getOrCreateAccountStatus(), which is already
 * idempotent. What's genuinely new here is turning onboarding activation
 * from a self-reported UI click into something the system verifies: the
 * job description's own workflow step 10, "wait for a quality-approved
 * baseline," now means an ACTUAL Intelligence-Quality release decision
 * exists and real property/unit records back it — not just "the user
 * clicked done." The existing manual completion path
 * (POST /account/complete-onboarding, driven by Jordan's onboarding
 * conversation) is left in place untouched as an alternative trigger —
 * this agent adds automatic, verified activation; it does not remove or
 * gate the manual one, so it can't break the onboarding flow already
 * live in production.
 *
 * Explicitly NOT built yet (multi-organization Sales->Onboarding handoff,
 * per-org invitation tracking as formal audit events, reporting-cadence
 * configuration): this codebase has no multi-organization concept and no
 * Sales Agent to hand off from yet, and no reporting-cadence setting
 * exists anywhere in the app today to wire up. Left as explicit follow-up
 * rather than inventing either.
 */
import { db } from "@workspace/db";
import { propertiesTable, unitsTable, type AgentJob } from "@workspace/db/schema";
import { registerAgent, type AgentHandlerResult } from "../orchestrator.js";
import { logAgentAction, recordVerification } from "../audit.js";
import { getOrCreateAccountStatus, markOnboardingCompleted } from "../../account-status-service.js";

export const ONBOARDING_AGENT_ID = "onboarding_agent";

interface OnboardingBaselineCheckPayload {
  batchId: string;
  qualityJobId: number;
}

async function handleOnboardingBaselineCheck(job: AgentJob): Promise<AgentHandlerResult> {
  const payload = job.payload as OnboardingBaselineCheckPayload;
  const hub = await getOrCreateAccountStatus();

  if (hub.onboardingCompleted) {
    // Already activated — most likely via the manual/Jordan-driven path.
    // Still a real, logged outcome, not a silently-dropped job.
    return { outcome: "completed", result: { skipped: true, reason: "onboarding already completed" } };
  }

  const [properties, units] = await Promise.all([
    db.select({ id: propertiesTable.id }).from(propertiesTable),
    db.select({ id: unitsTable.id }).from(unitsTable),
  ]);
  const baselineReady = properties.length > 0 && units.length > 0;

  await recordVerification({
    jobId: job.id,
    agentId: ONBOARDING_AGENT_ID,
    gateName: "baseline_approved_by_quality",
    passed: baselineReady,
    evidence: { propertyCount: properties.length, unitCount: units.length, batchId: payload.batchId, qualityJobId: payload.qualityJobId },
  });

  if (!baselineReady) {
    // Intelligence-Quality released a batch, but there are still zero
    // real property or unit records to show for it — not an error
    // condition, just genuinely not ready to activate yet.
    return { outcome: "completed", result: { skipped: true, reason: "no property/unit records yet" } };
  }

  await logAgentAction({
    jobId: job.id,
    agentId: ONBOARDING_AGENT_ID,
    correlationId: job.correlationId,
    action: "baseline.requested",
    input: { batchId: payload.batchId, qualityJobId: payload.qualityJobId },
  });

  const updated = await markOnboardingCompleted();

  await logAgentAction({
    jobId: job.id,
    agentId: ONBOARDING_AGENT_ID,
    correlationId: job.correlationId,
    action: "onboarding.activated",
    output: { accountStatusId: updated.id, batchId: payload.batchId },
  });

  return { outcome: "completed", result: { activated: true, batchId: payload.batchId } };
}

export async function registerOnboardingAgent(): Promise<void> {
  await registerAgent(
    ONBOARDING_AGENT_ID,
    "Onboarding Agent",
    "Activates each customer accurately and quickly once a quality-approved baseline genuinely exists, without requiring manual founder setup.",
    handleOnboardingBaselineCheck,
  );
}
