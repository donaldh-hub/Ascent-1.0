/**
 * Security and Access Agent — Build Sequence step 7 (grouped with
 * Infrastructure because both carry blocking/containment authority). Per
 * the job description: "Protect customer boundaries, identities,
 * permissions, data access, and audit evidence."
 *
 * Scope of THIS increment, stated plainly: there's no login-failure
 * logging, session-anomaly telemetry, or export-monitoring in this
 * codebase to detect intrusion-style anomalies from — building "login
 * anomaly detection" against data that doesn't exist would be fabricated,
 * not real. What IS real and independently checkable today is the
 * integrity of the access grants themselves: access-service.ts's
 * grantSiteAccess() already enforces "you can only grant access to a
 * site you can see yourself" AT THE MOMENT OF GRANTING — but a granter's
 * own access can change afterward (revoked, reassigned), leaving a grant
 * they made looking valid when the least-privilege chain behind it no
 * longer holds. This agent re-verifies that chain independently and
 * continuously — the same "never trust the original check, re-derive it"
 * pattern Intelligence-Quality and Billing already use.
 *
 * Deliberately conservative: a finding here only ever gets FLAGGED for
 * human review, never auto-revoked. Automatically revoking a user's
 * access on a drift finding risks locking out someone legitimate on a
 * false positive (e.g. the granter's own access changed for an unrelated
 * reason) — that's a human call, not something Security should decide
 * unilaterally, even though "session revocation" is listed as within its
 * formal authority for confirmed incidents. A least-privilege drift
 * finding is not a confirmed incident.
 *
 * Runs as a self-rescheduling recurring job, same pattern as
 * infrastructure-agent.ts — see that file's header for the known
 * job-table-growth limitation this shares.
 */
import { db } from "@workspace/db";
import { userSiteAccessTable, type AgentJob } from "@workspace/db/schema";
import { registerAgent, type AgentHandlerResult } from "../orchestrator.js";
import { logAgentAction, recordVerification, raiseException } from "../audit.js";
import { getAccessibleSiteIds } from "../../access-service.js";
import { enqueueJob, hasPendingJob } from "../job-store.js";

export const SECURITY_ACCESS_AGENT_ID = "security_access_agent";

const GRANT_REVIEW_INTERVAL_MS = 15 * 60_000; // recheck every 15 minutes

interface GrantFinding {
  grantId: number;
  userId: number;
  siteId: number;
  granterUserId: number;
  issue: string;
}

async function handleGrantReview(job: AgentJob): Promise<AgentHandlerResult> {
  const grants = await db.select().from(userSiteAccessTable);
  const findings: GrantFinding[] = [];
  const granterAccessCache = new Map<number, number[]>();

  for (const grant of grants) {
    if (!granterAccessCache.has(grant.grantedByUserId)) {
      granterAccessCache.set(grant.grantedByUserId, await getAccessibleSiteIds(grant.grantedByUserId));
    }
    const granterSites = granterAccessCache.get(grant.grantedByUserId)!;
    if (!granterSites.includes(grant.siteId)) {
      findings.push({
        grantId: grant.id,
        userId: grant.userId,
        siteId: grant.siteId,
        granterUserId: grant.grantedByUserId,
        issue: "granter no longer has access to the site they granted",
      });
    }
  }

  await logAgentAction({
    jobId: job.id,
    agentId: SECURITY_ACCESS_AGENT_ID,
    correlationId: job.correlationId,
    action: "grant.reviewed",
    output: { totalGrants: grants.length, findingCount: findings.length },
  });

  await recordVerification({
    jobId: job.id,
    agentId: SECURITY_ACCESS_AGENT_ID,
    gateName: "grant_least_privilege_still_valid",
    passed: findings.length === 0,
    evidence: findings.length > 0 ? { findings } : { totalGrants: grants.length },
  });

  if (findings.length > 0) {
    await raiseException({
      jobId: job.id,
      agentId: SECURITY_ACCESS_AGENT_ID,
      correlationId: job.correlationId,
      severity: "medium",
      whatHappened: `${findings.length} site-access grant(s) are held by users whose granter no longer has access to that site themselves — a least-privilege chain that no longer holds.`,
      evidence: { findings },
      attemptedActions: ["Independently re-verified every current grant's granter against their current accessible sites"],
      whyRecoveryStopped: "Auto-revoking risks locking out a legitimate user on a false positive (e.g. the granter's own access changed for an unrelated reason) — this needs human review, not an automatic revoke.",
      availableOptions: findings.map((f) => `Review grant ${f.grantId} (user ${f.userId} -> site ${f.siteId}, originally granted by ${f.granterUserId})`),
      decisionRequested: "Review the flagged grants and revoke any that are no longer appropriate.",
    });
  }

  await enqueueJob({
    agentId: SECURITY_ACCESS_AGENT_ID,
    triggerEvent: "scheduled_grant_review",
    payload: {},
    runAt: new Date(Date.now() + GRANT_REVIEW_INTERVAL_MS),
  });

  return { outcome: "completed", result: { totalGrants: grants.length, findingCount: findings.length } };
}

export async function registerSecurityAccessAgent(): Promise<void> {
  await registerAgent(
    SECURITY_ACCESS_AGENT_ID,
    "Security and Access Agent",
    "Independently re-verifies that every site-access grant's least-privilege chain still holds, flagging drift for human review rather than auto-revoking.",
    handleGrantReview,
  );
}

/**
 * Enqueues the first scheduled grant review — call once at server
 * startup, after registerSecurityAccessAgent(). Idempotent, same
 * restart-safety pattern as infrastructure-agent.ts.
 */
export async function scheduleInitialGrantReview(): Promise<void> {
  if (await hasPendingJob(SECURITY_ACCESS_AGENT_ID)) return;
  await enqueueJob({ agentId: SECURITY_ACCESS_AGENT_ID, triggerEvent: "scheduled_grant_review", payload: {} });
}
