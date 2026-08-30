/**
 * Sales Agent — Build Sequence step 8. Per the job description: "Acquire
 * qualified customers and convert them into paid Ascent subscriptions
 * without misrepresenting the product, its evidence, its readiness, or
 * its pricing."
 *
 * Consistency check performed before writing any of this (the kind
 * explicitly asked for): the job description assumes a multi-tenant
 * model where many organizations sign up and convert independently.
 * Ascent-1.0 is architecturally single-hub today — one account_status
 * row per deployment (see account_status.ts, and the whole access model
 * built around it in PR #4). Building a full multi-lead conversion
 * pipeline against a single-tenant backend would be inconsistent with
 * what actually exists, not a real capability. So:
 *
 * - Lead intake, qualification (real, stated criteria — not invented
 *   per-lead judgment), and price quoting (the EXISTING, locked pricing
 *   formula — calculateTierForUnitCount(), no second formula introduced)
 *   are built for real. None of this requires multi-tenancy — a lead is
 *   simply a prospect who hasn't become this deployment's one customer
 *   yet.
 * - If a lead qualifies while this deployment ALREADY has an active
 *   subscriber, that's flagged as a real architectural conflict (this
 *   app has no second-customer conversion path yet) via an exception —
 *   never silently mishandled or faked as a success.
 * - "Create subscription checkout" and "confirm conversion" are NOT
 *   automated — there is no real payment processor integrated (same
 *   blocker flagged for the Billing Agent), and building a fake checkout
 *   would misrepresent readiness, which is exactly what this agent's own
 *   mission statement forbids. Conversion is a manual, founder-confirmed
 *   action (POST /sales/leads/:id/convert) that calls the EXISTING
 *   subscribe() (account-status-service.ts) — not invented here, and not
 *   something Sales does autonomously.
 */
import { db } from "@workspace/db";
import { leadsTable, type AgentJob } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { registerAgent, type AgentHandlerResult } from "../orchestrator.js";
import { logAgentAction, recordVerification, raiseException } from "../audit.js";
import { getOrCreateAccountStatus } from "../../account-status-service.js";
import { calculateTierForUnitCount } from "../../pricing-service.js";

export const SALES_AGENT_ID = "sales_agent";

interface LeadQualificationPayload {
  leadId: number;
}

async function handleLeadQualification(job: AgentJob): Promise<AgentHandlerResult> {
  const payload = job.payload as LeadQualificationPayload;
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, payload.leadId)).limit(1);
  if (!lead) {
    return { outcome: "failed_final", error: `Lead ${payload.leadId} not found` };
  }

  await logAgentAction({
    jobId: job.id,
    agentId: SALES_AGENT_ID,
    correlationId: job.correlationId,
    action: "lead.created",
    input: { leadId: lead.id, organizationName: lead.organizationName },
  });

  // Qualification: real, stated criteria (matches the job description's
  // "qualification criteria" required input) — never an invented,
  // unexplainable per-lead judgment call.
  const reasons: string[] = [];
  if (lead.siteCount <= 0) reasons.push("declared site count must be greater than zero");
  if (!lead.contactEmail) reasons.push("contact email is required");
  if (!lead.painDescription || lead.painDescription.trim().length === 0) reasons.push("no operating problem described");

  await recordVerification({
    jobId: job.id,
    agentId: SALES_AGENT_ID,
    gateName: "qualification_criteria_met",
    passed: reasons.length === 0,
    evidence: { leadId: lead.id, reasons },
  });

  if (reasons.length > 0) {
    await db.update(leadsTable).set({ status: "disqualified", disqualificationReason: reasons.join("; ") }).where(eq(leadsTable.id, lead.id));
    await logAgentAction({ jobId: job.id, agentId: SALES_AGENT_ID, correlationId: job.correlationId, action: "lead.disqualified", output: { reasons } });
    return { outcome: "completed", result: { leadId: lead.id, status: "disqualified", reasons } };
  }

  await logAgentAction({ jobId: job.id, agentId: SALES_AGENT_ID, correlationId: job.correlationId, action: "lead.qualified" });

  const hub = await getOrCreateAccountStatus();
  if (hub.subscriptionStatus === "subscribed") {
    await raiseException({
      jobId: job.id,
      agentId: SALES_AGENT_ID,
      correlationId: job.correlationId,
      severity: "medium",
      whatHappened: `Lead ${lead.id} (${lead.organizationName}) qualified, but this deployment already has an active subscriber — Ascent-1.0 is single-tenant today and has no second-customer conversion path yet.`,
      evidence: { leadId: lead.id, hubSubscriptionStatus: hub.subscriptionStatus },
      attemptedActions: ["Checked whether this deployment already has an active subscriber before quoting"],
      whyRecoveryStopped: "Converting a second customer requires real multi-tenant architecture that doesn't exist yet — a product/infra decision, not something Sales can resolve on its own.",
      availableOptions: ["Provision a separate deployment for this lead", "Treat multi-tenancy as a planned future requirement"],
      decisionRequested: `Decide how to handle lead ${lead.id} given this deployment already belongs to another subscriber.`,
    });
    // Still quote below — the quote itself is honest and harmless; only
    // the conversion path is blocked, and that block is enforced at the
    // manual /sales/leads/:id/convert endpoint, not skipped here.
  }

  const tier = calculateTierForUnitCount(lead.siteCount);
  await db
    .update(leadsTable)
    .set({ status: "quoted", quotedTierLabel: tier.tierLabel, quotedMonthlyTotal: tier.monthlyTotal })
    .where(eq(leadsTable.id, lead.id));
  await logAgentAction({ jobId: job.id, agentId: SALES_AGENT_ID, correlationId: job.correlationId, action: "quote.generated", output: { tier } });

  return { outcome: "completed", result: { leadId: lead.id, status: "quoted", tier } };
}

export async function registerSalesAgent(): Promise<void> {
  await registerAgent(
    SALES_AGENT_ID,
    "Sales Agent",
    "Qualifies leads against stated criteria and generates a transparent price quote from the decided pricing formula. Subscription checkout/conversion is not automated — no real payment processor exists (same blocker as the Billing Agent) — conversion is a manual, founder-confirmed action.",
    handleLeadQualification,
  );
}
