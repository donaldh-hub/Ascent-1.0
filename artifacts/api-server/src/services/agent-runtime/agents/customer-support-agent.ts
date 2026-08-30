/**
 * Customer-Support Agent — Build Sequence step 6 (grouped with Jordan
 * because both expose the system to customers). Per the job description:
 * "Resolve routine product, access, upload, and report-use problems
 * quickly while preserving customer trust and escalating only unresolved
 * exceptions."
 *
 * Scope of THIS increment, stated plainly: this codebase had no support-
 * ticketing concept at all before this — support_cases is genuinely new,
 * not a shadow of anything. Two categories get a REAL automated recovery
 * step because the underlying capability already exists:
 *
 * - login_failure: resends a real login link via the existing
 *   createLoginToken/sendMagicLinkEmail (auth-service.ts, email-service.ts)
 *   — the same functions POST /auth/request-link already uses.
 * - upload_failure: gathers REAL diagnostics from the Data-Ingestion
 *   Agent's own job history (agent_jobs, PR #13) for that user, and
 *   escalates with the actual failure evidence attached if a real
 *   unresolved ingestion failure shows up — it does not invent a fix for
 *   a data problem it can't see into.
 *
 * Any other category ("other") has no approved playbook yet and is
 * escalated immediately rather than improvising a response — exactly
 * what the spec means by "no improvised responses outside the approved
 * library."
 */
import { db } from "@workspace/db";
import { supportCasesTable, agentJobsTable, type AgentJob } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { registerAgent, type AgentHandlerResult } from "../orchestrator.js";
import { logAgentAction, recordVerification, raiseException } from "../audit.js";
import { getUserById } from "../../access-service.js";
import { createLoginToken } from "../../auth-service.js";
import { sendMagicLinkEmail } from "../../email-service.js";
import { DATA_INGESTION_AGENT_ID } from "./data-ingestion-agent.js";

export const CUSTOMER_SUPPORT_AGENT_ID = "customer_support_agent";

const UNRESOLVED_JOB_STATES = ["FAILED_FINAL", "ESCALATED", "BLOCKED_BY_POLICY"];

interface SupportCasePayload {
  caseId: number;
}

async function handleSupportCase(job: AgentJob): Promise<AgentHandlerResult> {
  const payload = job.payload as SupportCasePayload;
  const [supportCase] = await db.select().from(supportCasesTable).where(eq(supportCasesTable.id, payload.caseId)).limit(1);
  if (!supportCase) {
    return { outcome: "failed_final", error: `Support case ${payload.caseId} not found` };
  }

  const user = await getUserById(supportCase.userId);
  if (!user) {
    await raiseException({
      jobId: job.id,
      agentId: CUSTOMER_SUPPORT_AGENT_ID,
      correlationId: job.correlationId,
      severity: "high",
      whatHappened: `Support case ${supportCase.id} references user ${supportCase.userId}, who no longer exists.`,
      evidence: { caseId: supportCase.id, userId: supportCase.userId },
      attemptedActions: ["Looked up the user referenced by the case"],
      whyRecoveryStopped: "Cannot verify identity for a user that doesn't exist — needs human review, not an automated recovery attempt.",
      availableOptions: ["Investigate why the case references a missing user", "Close the case as invalid"],
      decisionRequested: `Review support case ${supportCase.id} — referenced user no longer exists.`,
    });
    await db.update(supportCasesTable).set({ status: "escalated" }).where(eq(supportCasesTable.id, supportCase.id));
    return { outcome: "escalated", error: "Referenced user not found" };
  }

  await logAgentAction({
    jobId: job.id,
    agentId: CUSTOMER_SUPPORT_AGENT_ID,
    correlationId: job.correlationId,
    action: "identity.verified",
    organizationId: user.hubId,
    input: { caseId: supportCase.id, userId: user.id },
  });

  if (supportCase.category === "login_failure") {
    const { token } = await createLoginToken(user.id);
    const sendResult = await sendMagicLinkEmail({ to: user.email, loginUrl: `/api/auth/verify?token=${token}` });

    await logAgentAction({
      jobId: job.id,
      agentId: CUSTOMER_SUPPORT_AGENT_ID,
      correlationId: job.correlationId,
      action: "recovery.attempted",
      output: { action: "resend_login_link", stubbed: sendResult.stubbed },
    });
    await recordVerification({
      jobId: job.id,
      agentId: CUSTOMER_SUPPORT_AGENT_ID,
      gateName: "recovery_action_permitted",
      passed: true,
      evidence: { category: "login_failure", action: "resend_login_link" },
    });

    const recoveryOutcome = sendResult.stubbed
      ? "Login link regenerated (email delivery stubbed — no real provider configured yet)"
      : "Login link resent";
    await db
      .update(supportCasesTable)
      .set({ status: "monitoring", recoveryAttempted: true, recoveryOutcome })
      .where(eq(supportCasesTable.id, supportCase.id));

    await logAgentAction({ jobId: job.id, agentId: CUSTOMER_SUPPORT_AGENT_ID, correlationId: job.correlationId, action: "case.resolved" });
    return { outcome: "completed", result: { caseId: supportCase.id, action: "resend_login_link", stubbed: sendResult.stubbed } };
  }

  if (supportCase.category === "upload_failure") {
    const recentIngestionJobs = await db
      .select()
      .from(agentJobsTable)
      .where(eq(agentJobsTable.agentId, DATA_INGESTION_AGENT_ID))
      .orderBy(desc(agentJobsTable.id))
      .limit(20);
    const relevantJobs = recentIngestionJobs.filter((j) => j.authorizedUserId === user.id).slice(0, 5);

    await logAgentAction({
      jobId: job.id,
      agentId: CUSTOMER_SUPPORT_AGENT_ID,
      correlationId: job.correlationId,
      action: "diagnostic.completed",
      output: { relevantJobCount: relevantJobs.length, jobStates: relevantJobs.map((j) => j.state) },
    });

    const diagnostics = { relevantJobs: relevantJobs.map((j) => ({ id: j.id, state: j.state, lastError: j.lastError, createdAt: j.createdAt })) };
    await db.update(supportCasesTable).set({ diagnostics }).where(eq(supportCasesTable.id, supportCase.id));

    const hasUnresolvedFailure = relevantJobs.some((j) => UNRESOLVED_JOB_STATES.includes(j.state));
    if (hasUnresolvedFailure) {
      await raiseException({
        jobId: job.id,
        agentId: CUSTOMER_SUPPORT_AGENT_ID,
        correlationId: job.correlationId,
        severity: "medium",
        whatHappened: `Support case ${supportCase.id}: user ${user.id} reported an upload failure, and diagnostics show a real unresolved ingestion failure in their recent job history.`,
        evidence: diagnostics,
        attemptedActions: ["Gathered the user's recent Data-Ingestion Agent job history"],
        whyRecoveryStopped: "An ingestion failure needs investigation of the actual uploaded file/data — not a support-side self-healing action.",
        availableOptions: ["Review the failed ingestion job's error and the source file", "Ask the user to re-upload a corrected file"],
        decisionRequested: `Investigate the ingestion failure behind support case ${supportCase.id}.`,
      });
      await db.update(supportCasesTable).set({ status: "escalated" }).where(eq(supportCasesTable.id, supportCase.id));
      return { outcome: "escalated", error: "Unresolved ingestion failure found in diagnostics" };
    }

    await db
      .update(supportCasesTable)
      .set({ status: "resolved", resolvedAt: new Date(), recoveryOutcome: "No unresolved ingestion failures found in recent job history" })
      .where(eq(supportCasesTable.id, supportCase.id));
    await logAgentAction({ jobId: job.id, agentId: CUSTOMER_SUPPORT_AGENT_ID, correlationId: job.correlationId, action: "case.resolved" });
    return { outcome: "completed", result: { caseId: supportCase.id, diagnostics } };
  }

  // category === "other" — no approved playbook exists yet. Escalate
  // rather than improvise a response outside the approved library.
  await raiseException({
    jobId: job.id,
    agentId: CUSTOMER_SUPPORT_AGENT_ID,
    correlationId: job.correlationId,
    severity: "low",
    whatHappened: `Support case ${supportCase.id} ("${supportCase.description}") has no automated playbook for category "${supportCase.category}".`,
    evidence: { caseId: supportCase.id, category: supportCase.category, description: supportCase.description },
    attemptedActions: ["Checked for a matching automated playbook"],
    whyRecoveryStopped: "No approved playbook exists for this category — routed to a human rather than improvised.",
    availableOptions: ["Respond to the case manually", "Add an approved playbook for this category if it recurs"],
    decisionRequested: `Respond to support case ${supportCase.id} manually.`,
  });
  await db.update(supportCasesTable).set({ status: "escalated" }).where(eq(supportCasesTable.id, supportCase.id));
  return { outcome: "escalated", error: "No automated playbook for this category" };
}

export async function registerCustomerSupportAgent(): Promise<void> {
  await registerAgent(
    CUSTOMER_SUPPORT_AGENT_ID,
    "Customer-Support Agent",
    "Resolves routine product, access, and upload problems using real diagnostics and approved recovery actions; escalates anything without an approved playbook rather than improvising.",
    handleSupportCase,
  );
}
