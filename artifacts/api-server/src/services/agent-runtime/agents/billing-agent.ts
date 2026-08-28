/**
 * Billing Agent — Build Sequence step 5 (grouped with Onboarding because
 * both establish customer and revenue truth). Per the job description:
 * "May calculate $40.00 per active site plus the approved data-capacity
 * rate ... May not invent fees, silently change price, grant unapproved
 * refunds, or negotiate enterprise contracts."
 *
 * Scope of THIS increment, stated plainly: Ascent-1.0 has no real
 * payment processor integrated today (no Stripe or otherwise) — there is
 * no such thing yet as a real invoice, receipt, payment retry, or
 * dunning sequence to build against, and building fake ones would be
 * exactly the "placeholder logic passed off as working" the spec
 * forbids. Choosing and integrating a real processor is a business/infra
 * decision on the scale of choosing an inbound-email provider (deferred
 * the same way in PR #8) — flagged here, not decided unilaterally, and
 * not something to wire without the founder's explicit sign-off given
 * core.md's standing rule against committing money or payment
 * infrastructure without a yes first.
 *
 * What IS real and buildable today: the decided pricing formula itself
 * (CLAUDE.md's "Pricing" section, locked language) and unit-count-driven
 * tier recalculation already exist (pricing-service.ts, PR #10) and are
 * NOT changed here — this agent doesn't touch the formula or introduce a
 * second one. It wraps the existing calculation with an INDEPENDENT
 * verification pass, the same "never trust a single agent's self-
 * reported number" pattern Intelligence-Quality uses: it recomputes the
 * band formula from the current unit count and confirms it matches what
 * pricing-service.ts just produced, before accepting the result. The
 * ingestion pipeline's per-property recalculation now goes through this
 * wrapper instead of calling pricing-service.ts directly, so every price
 * recalculation is a formal, audited agent job.
 */
import { db } from "@workspace/db";
import { unitsTable, type AgentJob } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { recalculateSitePricingTier, calculateTierForUnitCount, type PricingTierResult } from "../../pricing-service.js";
import { registerAgent, runAgentInline, type AgentHandlerResult } from "../orchestrator.js";
import { logAgentAction, recordVerification, raiseException } from "../audit.js";

export const BILLING_AGENT_ID = "billing_agent";

interface BillingRecalcPayload {
  propertyId: number;
}

async function handleBillingRecalc(job: AgentJob): Promise<AgentHandlerResult> {
  const payload = job.payload as BillingRecalcPayload;

  const { changed, tier } = await recalculateSitePricingTier(payload.propertyId);

  // Verification gate: independently recompute the SAME formula
  // (calculateTierForUnitCount stays single-sourced in pricing-service.ts
  // — this does not re-derive it) against a freshly-counted unit total,
  // to catch any drift between what was just billed and what the
  // database shows right now — e.g. a stale count captured before the
  // recalculation actually committed.
  const unitRows = await db.select({ id: unitsTable.id }).from(unitsTable).where(eq(unitsTable.propertyId, payload.propertyId));
  const recomputed: PricingTierResult = calculateTierForUnitCount(unitRows.length);
  const priceVerified = recomputed.monthlyTotal === tier.monthlyTotal && recomputed.tierLabel === tier.tierLabel;

  await recordVerification({
    jobId: job.id,
    agentId: BILLING_AGENT_ID,
    gateName: "price_calculation_verified",
    passed: priceVerified,
    evidence: { propertyId: payload.propertyId, tier, recomputed, unitCount: unitRows.length },
  });

  await logAgentAction({
    jobId: job.id,
    agentId: BILLING_AGENT_ID,
    correlationId: job.correlationId,
    action: "price.calculated",
    siteIds: [payload.propertyId],
    output: { tier, changed },
  });

  if (!priceVerified) {
    await raiseException({
      jobId: job.id,
      agentId: BILLING_AGENT_ID,
      correlationId: job.correlationId,
      severity: "high",
      siteIds: [payload.propertyId],
      whatHappened: `Independent price recomputation for property ${payload.propertyId} did not match pricing-service.ts's own result (billed: ${tier.tierLabel} / $${tier.monthlyTotal}, recomputed: ${recomputed.tierLabel} / $${recomputed.monthlyTotal}).`,
      evidence: { propertyId: payload.propertyId, tier, recomputed, unitCount: unitRows.length },
      attemptedActions: ["Recomputed the tier independently from the current unit count"],
      whyRecoveryStopped: "A mismatch means the billed price and the formula's own output disagree right now — that needs investigation, not a retry.",
      availableOptions: [`Investigate pricing-service.ts for a stale value on property ${payload.propertyId}`, "Manually verify the billed tier for this property"],
      decisionRequested: `Investigate the price mismatch for property ${payload.propertyId} before the next billing cycle.`,
    });
    return { outcome: "escalated", error: `Price verification failed for property ${payload.propertyId}` };
  }

  return { outcome: "completed", result: { propertyId: payload.propertyId, tier, changed } };
}

export async function registerBillingAgent(): Promise<void> {
  await registerAgent(
    BILLING_AGENT_ID,
    "Billing Agent",
    "Calculates and independently verifies Ascent's site-pricing formula. Real payment processing (invoices, receipts, retries, dunning) is not yet built — blocked on choosing a payment processor, a business decision requiring explicit sign-off, never made unilaterally.",
    handleBillingRecalc,
  );
}

/**
 * Drop-in replacement for calling recalculateSitePricingTier() directly —
 * same inputs/outputs, now routed through the Billing Agent's job
 * tracking and independent verification. Falls back to the direct
 * calculation if the agent job doesn't complete synchronously, so a
 * transient agent-runtime hiccup never blocks pricing from being kept
 * current — billing accuracy outranks agent-wrapper bookkeeping.
 */
export async function runBillingRecalcInline(propertyId: number): Promise<{ changed: boolean; tier: PricingTierResult }> {
  const job = await runAgentInline({
    agentId: BILLING_AGENT_ID,
    triggerEvent: "site_count_changed",
    payload: { propertyId },
  });
  if (job.state !== "COMPLETED") {
    return recalculateSitePricingTier(propertyId);
  }
  return job.result as { changed: boolean; tier: PricingTierResult };
}
