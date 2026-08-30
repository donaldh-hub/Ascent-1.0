/**
 * Data-Ingestion Agent — first real department agent (Build Sequence
 * step 4; the runtime it executes under is PR #13). Per the job
 * description doc: "Convert customer uploads and approved inbound emails
 * into normalized, traceable Ascent records while protecting the truth
 * layer." This wraps the EXISTING real ingestion pipeline
 * (importWorkOrderRows / work-order-import-service.ts) — it does not
 * reimplement parsing, resolution, or governance classification. Per the
 * spec's own Shared Runtime Contract rule 2, shadowing that logic here
 * would be exactly what's prohibited.
 *
 * What this agent adds on top of the existing pipeline: a formal agent
 * identity, job-state tracking, the audit events the job description
 * requires, an independent-of-the-pipeline verification gate (row totals
 * actually reconcile), and a handoff to the Intelligence-Quality Agent
 * once ingestion completes — none of which existed before this agent.
 *
 * This agent also owns soliciting the next report, on a fixed monthly
 * schedule (scheduled_report_reminder trigger, branched on below) — it's
 * the natural upstream half of "convert uploads into records": getting a
 * report to arrive at all. One property with no designated report
 * contact (properties.supervisorEmail) is simply skipped, not an error —
 * that's normal for a property mid-setup, not a system failure.
 */
import { db } from "@workspace/db";
import { propertiesTable, type AgentJob } from "@workspace/db/schema";
import type { ImportMode } from "../../governance-service.js";
import { importWorkOrderRows, type ImportWorkOrderRowsResult } from "../../work-order-import-service.js";
import { sendReportReminderEmail } from "../../email-service.js";
import { registerAgent, runAgentInline, type AgentHandlerResult } from "../orchestrator.js";
import { logAgentAction, recordVerification, raiseException, createHandoff } from "../audit.js";
import { enqueueJob, hasPendingJob } from "../job-store.js";
import { INTELLIGENCE_QUALITY_AGENT_ID } from "./intelligence-quality-agent.js";

export const DATA_INGESTION_AGENT_ID = "data_ingestion_agent";

export interface DataIngestionPayload {
  rows: Record<string, string>[];
  sourceFileName?: string;
  slaDeadlineHours?: number;
  createWorkflowItems?: boolean;
  importMode?: ImportMode;
}

const REPORT_REMINDER_TRIGGER = "scheduled_report_reminder";

/** Midnight UTC on the 1st of the month after `from`. */
function nextMonthStartUTC(from: Date): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
}

async function handleReportReminder(job: AgentJob): Promise<AgentHandlerResult> {
  const properties = await db.select().from(propertiesTable);

  let sent = 0;
  let skippedNoContact = 0;
  for (const property of properties) {
    if (!property.supervisorEmail) {
      skippedNoContact++;
      continue;
    }
    await sendReportReminderEmail({ to: property.supervisorEmail, propertyName: property.name });
    sent++;
  }

  await logAgentAction({
    jobId: job.id,
    agentId: DATA_INGESTION_AGENT_ID,
    correlationId: job.correlationId,
    action: "report_reminder.sent",
    output: { propertiesReminded: sent, propertiesSkippedNoContact: skippedNoContact },
  });

  // Fixed calendar schedule — self-reschedule for the 1st of next month
  // regardless of this run's outcome, rather than adding a second
  // scheduling mechanism next to the orchestrator's own poll loop.
  await enqueueJob({
    agentId: DATA_INGESTION_AGENT_ID,
    triggerEvent: REPORT_REMINDER_TRIGGER,
    payload: {},
    runAt: nextMonthStartUTC(new Date()),
  });

  return { outcome: "completed", result: { propertiesReminded: sent, propertiesSkippedNoContact: skippedNoContact } };
}

async function handleDataIngestion(job: AgentJob): Promise<AgentHandlerResult> {
  if (job.triggerEvent === REPORT_REMINDER_TRIGGER) {
    return handleReportReminder(job);
  }

  const payload = job.payload as DataIngestionPayload;

  await logAgentAction({
    jobId: job.id,
    agentId: DATA_INGESTION_AGENT_ID,
    correlationId: job.correlationId,
    action: "source.received",
    organizationId: job.organizationId ?? undefined,
    input: { sourceFileName: payload.sourceFileName ?? null, rowCount: payload.rows.length },
  });

  let result: ImportWorkOrderRowsResult;
  try {
    result = await importWorkOrderRows({
      rows: payload.rows,
      slaDeadlineHours: payload.slaDeadlineHours,
      createWorkflowItems: payload.createWorkflowItems,
      importMode: payload.importMode,
      sourceFileName: payload.sourceFileName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAgentAction({
      jobId: job.id,
      agentId: DATA_INGESTION_AGENT_ID,
      correlationId: job.correlationId,
      action: "ingestion.failed",
      input: { sourceFileName: payload.sourceFileName ?? null },
      output: { error: message },
    });
    // A thrown error from the pipeline itself (bad row shape, DB error) is
    // exactly the kind of thing a retry might clear (transient DB issue) —
    // let the orchestrator's normal retry/backoff handle it.
    return { outcome: "retry", error: message };
  }

  // Verification gate: eligibility totals reconcile. Every row must land in
  // exactly one bucket — imported or errored — and the governance
  // resolution buckets must sum to the same total. This is the ingestion
  // agent's OWN gate (checking its own pipeline's arithmetic), distinct
  // from Intelligence-Quality's later, independent re-derivation of the
  // same numbers straight from the database.
  const totalRows = payload.rows.length;
  const importResultReconciles = result.imported + result.errors === totalRows;
  const governanceReconciles =
    result.governance.fullyResolved + result.governance.partiallyResolved + result.governance.unresolved === totalRows;
  const totalsReconcile = importResultReconciles && governanceReconciles;

  await recordVerification({
    jobId: job.id,
    agentId: DATA_INGESTION_AGENT_ID,
    gateName: "eligibility_totals_reconcile",
    passed: totalsReconcile,
    evidence: { totalRows, imported: result.imported, errors: result.errors, governance: result.governance },
  });

  await logAgentAction({
    jobId: job.id,
    agentId: DATA_INGESTION_AGENT_ID,
    correlationId: job.correlationId,
    action: "ingestion.completed",
    organizationId: job.organizationId ?? undefined,
    siteIds: result.touchedPropertyIds,
    output: { batchId: result.batchId, imported: result.imported, errors: result.errors, governance: result.governance },
  });

  if (!totalsReconcile) {
    // A row-count discrepancy is a data-integrity problem, not a
    // transient failure — retrying the same batch won't change the
    // arithmetic. This is the spec's "critical scope anomaly escalated
    // immediately" trigger, not a routine retry.
    await raiseException({
      jobId: job.id,
      agentId: DATA_INGESTION_AGENT_ID,
      correlationId: job.correlationId,
      severity: "high",
      organizationId: job.organizationId ?? undefined,
      siteIds: result.touchedPropertyIds,
      whatHappened: `Ingestion batch ${result.batchId}: row totals do not reconcile (${result.imported} imported + ${result.errors} errors vs ${totalRows} total rows; governance buckets sum to ${result.governance.fullyResolved + result.governance.partiallyResolved + result.governance.unresolved}).`,
      evidence: { batchId: result.batchId, totalRows, result },
      attemptedActions: ["Ran importWorkOrderRows() to completion", "Verified totals against the reported row count"],
      whyRecoveryStopped: "This is an arithmetic/data-integrity discrepancy in the ingestion pipeline itself, not a condition a retry can fix.",
      availableOptions: [`Investigate the import pipeline for a counting bug in batch ${result.batchId}`, "Manually reconcile the affected batch"],
      decisionRequested: `Investigate why ingestion batch ${result.batchId}'s row totals don't reconcile.`,
    });
    return { outcome: "escalated", error: `Row totals did not reconcile for batch ${result.batchId} — see agent_exceptions.` };
  }

  // Handoff to Intelligence-Quality — per the Agent Handoff Map: "Data
  // Ingestion -> Intelligence Quality after normalized candidate records
  // and ingestion summary are ready." Queued (not inline): the upload
  // response doesn't need to wait on the quality re-check to return.
  const qualityJob = await enqueueJob({
    agentId: INTELLIGENCE_QUALITY_AGENT_ID,
    triggerEvent: "ingestion.completed",
    payload: { batchId: result.batchId, ingestionJobId: job.id, touchedPropertyIds: result.touchedPropertyIds },
    correlationId: job.correlationId,
    organizationId: job.organizationId ?? undefined,
    siteIds: result.touchedPropertyIds,
    authorizedUserId: job.authorizedUserId ?? undefined,
  });

  await createHandoff({
    correlationId: job.correlationId,
    sendingAgentId: DATA_INGESTION_AGENT_ID,
    receivingAgentId: INTELLIGENCE_QUALITY_AGENT_ID,
    organizationId: job.organizationId ?? undefined,
    siteIds: result.touchedPropertyIds,
    authorizedUserId: job.authorizedUserId ?? undefined,
    sourceIds: [result.batchId],
    dataClassification: "normalized_work_order_records",
    state: "QUEUED",
    completedActions: ["source.received", "ingestion.completed", "eligibility_totals_reconcile"],
    unresolvedItems: ["quality_release_decision_pending"],
    requiredNextAction: `intelligence_quality_agent job ${qualityJob.id} evaluates batch ${result.batchId} for release`,
  });

  return { outcome: "completed", result };
}

export async function registerDataIngestionAgent(): Promise<void> {
  await registerAgent(
    DATA_INGESTION_AGENT_ID,
    "Data-Ingestion Agent",
    "Converts customer uploads and approved inbound emails into normalized, traceable Ascent records while protecting the truth layer from incomplete, duplicated, or misassigned data.",
    handleDataIngestion,
  );
}

/**
 * Enqueues the first monthly report-reminder run, for the 1st of next
 * month — call once at server startup, after registerDataIngestionAgent().
 * Idempotent against restarts: checks for a pending job of specifically
 * this trigger event, not just any Data-Ingestion job — ordinary
 * per-upload ingestion traffic (a different trigger event, same
 * agentId) must never make this look "already scheduled" and silently
 * starve the monthly reminder chain from ever getting set up.
 */
export async function scheduleInitialReportReminder(): Promise<void> {
  if (await hasPendingJob(DATA_INGESTION_AGENT_ID, REPORT_REMINDER_TRIGGER)) return;
  await enqueueJob({
    agentId: DATA_INGESTION_AGENT_ID,
    triggerEvent: REPORT_REMINDER_TRIGGER,
    payload: {},
    runAt: nextMonthStartUTC(new Date()),
  });
}

/**
 * Runs ingestion inline (synchronously, within the caller's own request)
 * and returns the real ImportWorkOrderRowsResult — used by routes/services
 * that have always returned their import result in the same HTTP response
 * (POST /work-orders/import, inbound-email-service.ts) so their existing
 * contract doesn't change. Throws if the job didn't reach COMPLETED (e.g.
 * it's now RETRY_SCHEDULED or was BLOCKED_BY_POLICY) — callers should
 * treat that as "accepted, still processing" rather than assume a result.
 */
export async function runDataIngestionInline(input: {
  payload: DataIngestionPayload;
  organizationId?: number;
  authorizedUserId?: number;
}): Promise<ImportWorkOrderRowsResult> {
  const job = await runAgentInline({
    agentId: DATA_INGESTION_AGENT_ID,
    triggerEvent: "upload.completed",
    payload: input.payload,
    organizationId: input.organizationId,
    authorizedUserId: input.authorizedUserId,
  });

  if (job.state !== "COMPLETED") {
    throw new IngestionNotCompletedError(job.state, job.lastError ?? undefined);
  }
  return job.result as ImportWorkOrderRowsResult;
}

export class IngestionNotCompletedError extends Error {
  constructor(
    public readonly jobState: string,
    public readonly lastError?: string,
  ) {
    super(`Ingestion job did not complete synchronously (state: ${jobState}${lastError ? `, error: ${lastError}` : ""}). It will keep running in the background.`);
    this.name = "IngestionNotCompletedError";
  }
}
