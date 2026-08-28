/**
 * Evidence and audit log + founder exception queue (Build Sequence step 3).
 * Every material agent action is written here — this is what makes
 * "explain what happened" (Universal Architectural Test #4) answerable
 * after the fact, and what a Founder Control Center reads from.
 */
import { db } from "@workspace/db";
import {
  agentActionLogsTable,
  agentVerificationResultsTable,
  agentExceptionsTable,
  agentHandoffsTable,
  type AgentExceptionSeverity,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export async function logAgentAction(input: {
  jobId?: number;
  agentId: string;
  correlationId: string;
  action: string;
  organizationId?: number;
  siteIds?: number[];
  input?: unknown;
  output?: unknown;
}) {
  await db.insert(agentActionLogsTable).values({
    jobId: input.jobId,
    agentId: input.agentId,
    correlationId: input.correlationId,
    action: input.action,
    organizationId: input.organizationId,
    siteIds: input.siteIds ?? [],
    input: input.input as object | undefined,
    output: input.output as object | undefined,
  });
}

export async function recordVerification(input: {
  jobId: number;
  agentId: string;
  gateName: string;
  passed: boolean;
  evidence?: unknown;
}) {
  await db.insert(agentVerificationResultsTable).values({
    jobId: input.jobId,
    agentId: input.agentId,
    gateName: input.gateName,
    passed: input.passed,
    evidence: input.evidence as object | undefined,
  });
}

/**
 * Raises a founder exception. Per the spec's Founder Escalation Contract,
 * every field here is required at the call site — an escalation missing
 * evidence, attempted recovery, options, or an exact decision is exactly
 * the "incomplete escalation" the Chief Operating Agent is supposed to
 * reject, so the type forces the caller to supply them all up front.
 */
export async function raiseException(input: {
  jobId?: number;
  agentId: string;
  correlationId: string;
  severity: AgentExceptionSeverity;
  organizationId?: number;
  siteIds?: number[];
  whatHappened: string;
  evidence?: unknown;
  customerImpact?: string;
  operationalImpact?: string;
  attemptedActions: string[];
  whyRecoveryStopped: string;
  availableOptions: string[];
  recommendedOption?: string;
  decisionRequested: string;
  responseDeadline?: Date;
}) {
  const [row] = await db
    .insert(agentExceptionsTable)
    .values({
      jobId: input.jobId,
      agentId: input.agentId,
      correlationId: input.correlationId,
      severity: input.severity,
      organizationId: input.organizationId,
      siteIds: input.siteIds ?? [],
      whatHappened: input.whatHappened,
      evidence: input.evidence as object | undefined,
      customerImpact: input.customerImpact,
      operationalImpact: input.operationalImpact,
      attemptedActions: input.attemptedActions,
      whyRecoveryStopped: input.whyRecoveryStopped,
      availableOptions: input.availableOptions,
      recommendedOption: input.recommendedOption,
      decisionRequested: input.decisionRequested,
      responseDeadline: input.responseDeadline,
    })
    .returning();
  return row;
}

export async function resolveException(exceptionId: number, founderDecision: string) {
  const [row] = await db
    .update(agentExceptionsTable)
    .set({ status: "resolved", founderDecision, resolvedAt: new Date() })
    .where(eq(agentExceptionsTable.id, exceptionId))
    .returning();
  return row;
}

export async function listOpenExceptions() {
  return db.select().from(agentExceptionsTable).where(eq(agentExceptionsTable.status, "open"));
}

export async function createHandoff(input: {
  correlationId: string;
  sendingAgentId: string;
  receivingAgentId: string;
  organizationId?: number;
  siteIds?: number[];
  authorizedUserId?: number;
  sourceIds?: unknown[];
  dataClassification?: string;
  state: string;
  completedActions?: string[];
  unresolvedItems?: string[];
  deadline?: Date;
  requiredNextAction: string;
}) {
  const [row] = await db
    .insert(agentHandoffsTable)
    .values({
      correlationId: input.correlationId,
      sendingAgentId: input.sendingAgentId,
      receivingAgentId: input.receivingAgentId,
      organizationId: input.organizationId,
      siteIds: input.siteIds ?? [],
      authorizedUserId: input.authorizedUserId,
      sourceIds: input.sourceIds ?? [],
      dataClassification: input.dataClassification,
      state: input.state,
      completedActions: input.completedActions ?? [],
      unresolvedItems: input.unresolvedItems ?? [],
      deadline: input.deadline,
      requiredNextAction: input.requiredNextAction,
    })
    .returning();
  return row;
}
