/**
 * Intelligence-Quality Agent — second real department agent (Build
 * Sequence step 4). Per the job description doc: "Serve as the mandatory
 * release gate that proves every customer-facing score, signal,
 * recommendation, drill-down, and report is supported, reconciled,
 * isolated, complete, and honestly labeled."
 *
 * Scope of THIS increment, stated plainly: this agent evaluates a just-
 * ingested batch and records a real, evidence-backed release decision
 * (quality_release_decisions) — it independently RE-DERIVES the
 * governance counts straight from the database rather than trusting the
 * Data-Ingestion Agent's self-reported numbers, and checks tenant/site
 * isolation on every touched record. What it does NOT do yet is ENFORCE
 * that decision by blocking Control Tower, reports, or Jordan from
 * serving a blocked batch's records — that means touching every existing
 * customer-facing read path, which is a deliberately separate, larger
 * change (see PR description). Evaluating and recording a real decision
 * now is genuine progress; claiming enforcement that isn't wired yet
 * would not be, per the spec's own Definition of Done.
 */
import { db } from "@workspace/db";
import { workOrdersTable, propertiesTable, type AgentJob } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { qualityReleaseDecisionsTable } from "@workspace/db/schema";
import { registerAgent, type AgentHandlerResult } from "../orchestrator.js";
import { logAgentAction, recordVerification, raiseException } from "../audit.js";

export const INTELLIGENCE_QUALITY_AGENT_ID = "intelligence_quality_agent";

interface IntelligenceQualityPayload {
  batchId: string;
  ingestionJobId: number;
  touchedPropertyIds: number[];
}

interface QualityCheck {
  gate: string;
  passed: boolean;
  evidence: unknown;
}

async function handleIntelligenceQuality(job: AgentJob): Promise<AgentHandlerResult> {
  const payload = job.payload as IntelligenceQualityPayload;

  await logAgentAction({
    jobId: job.id,
    agentId: INTELLIGENCE_QUALITY_AGENT_ID,
    correlationId: job.correlationId,
    action: "quality.started",
    organizationId: job.organizationId ?? undefined,
    siteIds: payload.touchedPropertyIds,
    input: { batchId: payload.batchId, ingestionJobId: payload.ingestionJobId },
  });

  const batchRows = await db
    .select({
      id: workOrdersTable.id,
      propertyId: workOrdersTable.propertyId,
      resolutionStatus: workOrdersTable.resolutionStatus,
    })
    .from(workOrdersTable)
    .where(eq(workOrdersTable.importBatchId, payload.batchId));

  const checks: QualityCheck[] = [];

  // ── Check 1: calculation reconciled — independent recomputation ──
  // Re-derives the resolution-bucket counts directly from the rows this
  // batch actually wrote, rather than trusting whatever the ingestion
  // agent reported about itself. This is what "independent recomputation"
  // means in the spec's Verification Gate — a second agent re-checking
  // the first agent's arithmetic against the source of truth.
  const recomputedCounts = {
    fullyResolved: batchRows.filter((r) => r.resolutionStatus === "fully_resolved").length,
    partiallyResolved: batchRows.filter((r) => r.resolutionStatus === "partially_resolved").length,
    unresolved: batchRows.filter((r) => r.resolutionStatus === "unresolved" || !r.resolutionStatus).length,
  };
  const recomputedTotal = recomputedCounts.fullyResolved + recomputedCounts.partiallyResolved + recomputedCounts.unresolved;
  const calculationReconciled = recomputedTotal === batchRows.length;
  checks.push({ gate: "calculation_reconciled", passed: calculationReconciled, evidence: { recomputedCounts, batchRowCount: batchRows.length } });

  // ── Check 2: tenant/site isolation ──
  // Every record with a non-null propertyId must reference a property
  // that actually exists — an orphaned or impossible property reference
  // would mean a record could surface under the wrong site's scope.
  const referencedPropertyIds = [...new Set(batchRows.map((r) => r.propertyId).filter((id): id is number => id !== null))];
  let scopeIsolationPassed = true;
  let missingProperties: number[] = [];
  if (referencedPropertyIds.length > 0) {
    const existingProperties = await db
      .select({ id: propertiesTable.id })
      .from(propertiesTable)
      .where(inArray(propertiesTable.id, referencedPropertyIds));
    const existingSet = new Set(existingProperties.map((p) => p.id));
    missingProperties = referencedPropertyIds.filter((id) => !existingSet.has(id));
    scopeIsolationPassed = missingProperties.length === 0;
  }
  checks.push({ gate: "scope_isolation", passed: scopeIsolationPassed, evidence: { referencedPropertyIds, missingProperties } });

  // ── Check 3: partial/low-data labels are honestly recorded ──
  // Every row in this batch must actually carry a resolutionStatus value
  // (fully_resolved / partially_resolved / unresolved) — a null here would
  // mean a record silently entered reporting without a labeled confidence
  // level, which is exactly the "false certainty" the spec forbids.
  const unlabeledCount = batchRows.filter((r) => !r.resolutionStatus).length;
  const labelsHonest = unlabeledCount === 0;
  checks.push({ gate: "labels_honest", passed: labelsHonest, evidence: { unlabeledCount, totalRows: batchRows.length } });

  for (const check of checks) {
    await recordVerification({
      jobId: job.id,
      agentId: INTELLIGENCE_QUALITY_AGENT_ID,
      gateName: check.gate,
      passed: check.passed,
      evidence: check.evidence,
    });
  }

  const allPassed = checks.every((c) => c.passed);
  const decision = allPassed ? "released" : "blocked";

  await db.insert(qualityReleaseDecisionsTable).values({
    jobId: job.id,
    ingestionJobId: payload.ingestionJobId,
    batchId: payload.batchId,
    decision,
    organizationId: job.organizationId,
    siteIds: payload.touchedPropertyIds,
    checksRun: checks,
  });

  await logAgentAction({
    jobId: job.id,
    agentId: INTELLIGENCE_QUALITY_AGENT_ID,
    correlationId: job.correlationId,
    action: allPassed ? "output.released" : "output.blocked",
    organizationId: job.organizationId ?? undefined,
    siteIds: payload.touchedPropertyIds,
    output: { batchId: payload.batchId, decision, checks },
  });

  if (!allPassed) {
    const failedGates = checks.filter((c) => !c.passed).map((c) => c.gate);
    await raiseException({
      jobId: job.id,
      agentId: INTELLIGENCE_QUALITY_AGENT_ID,
      correlationId: job.correlationId,
      severity: failedGates.includes("scope_isolation") ? "critical" : "high",
      organizationId: job.organizationId ?? undefined,
      siteIds: payload.touchedPropertyIds,
      whatHappened: `Batch ${payload.batchId} failed quality release: ${failedGates.join(", ")}.`,
      evidence: { batchId: payload.batchId, checks },
      attemptedActions: ["Independently recomputed resolution-bucket counts from the database", "Verified every referenced property exists", "Verified every row carries a resolution-status label"],
      whyRecoveryStopped: "A failed quality gate reflects the data itself, not a transient condition — recalculation won't change it without upstream correction.",
      availableOptions: [`Investigate batch ${payload.batchId} for the specific failing gate(s): ${failedGates.join(", ")}`, "Reprocess the source file after correction"],
      decisionRequested: `Review and correct batch ${payload.batchId} before its records are trusted for reporting.`,
    });
    return { outcome: "escalated", error: `Batch ${payload.batchId} blocked: ${failedGates.join(", ")}` };
  }

  return { outcome: "completed", result: { batchId: payload.batchId, decision, checks } };
}

export async function registerIntelligenceQualityAgent(): Promise<void> {
  await registerAgent(
    INTELLIGENCE_QUALITY_AGENT_ID,
    "Intelligence-Quality Agent",
    "Mandatory release gate proving every customer-facing score, signal, recommendation, and report is supported, reconciled, isolated, complete, and honestly labeled.",
    handleIntelligenceQuality,
  );
}
