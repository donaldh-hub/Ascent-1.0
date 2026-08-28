/**
 * Policy and Permission Engine (Build Sequence step 2). This does NOT
 * reimplement access control — it wraps the existing, real access model
 * (users / user_site_access / access-service.ts) that already governs
 * every human-facing route in this app. Per the spec's Shared Runtime
 * Contract rule 2 ("shadow databases and duplicate scoring, billing,
 * access, or reporting logic are prohibited"), an agent's site-scope
 * check must reduce to the same getAccessibleSiteIds() the rest of the
 * app already trusts, never a parallel definition of "who can see what."
 *
 * What this file adds on top of that: an explicit, auditable allowlist of
 * which tool/action names each agent may call (agent_tool_permissions) —
 * the machine-enforceable version of each agent's job description's
 * "Operating Authority may / may not" boundary.
 */
import { db } from "@workspace/db";
import { agentToolPermissionsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { getAccessibleSiteIds } from "../access-service.js";

export class PolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

/**
 * True if every siteId in `siteIds` is one `userId` can actually see.
 * An agent acting on behalf of a specific authorized user (e.g. Jordan
 * answering that user's question) must never be able to touch a site
 * that user themselves couldn't — an agent is not a privilege escalation.
 * A job with no authorizedUserId (a system-triggered job, e.g. billing
 * recalculation) skips this check by design; it still must pass
 * assertToolAllowed below.
 */
export async function assertSiteScope(userId: number | undefined, siteIds: number[]): Promise<void> {
  if (userId == null || siteIds.length === 0) return;
  const accessible = await getAccessibleSiteIds(userId);
  const accessibleSet = new Set(accessible);
  const outOfScope = siteIds.filter((id) => !accessibleSet.has(id));
  if (outOfScope.length > 0) {
    throw new PolicyViolationError(
      `User ${userId} does not have access to site(s): ${outOfScope.join(", ")}`,
    );
  }
}

/**
 * True if `agentId` is allowed to call `toolName`. Unlisted tools default
 * to DENIED — an agent's authority is an explicit allowlist, not
 * "anything not forbidden," matching each job description's stated
 * "Operating Authority may... may not" split.
 */
export async function assertToolAllowed(agentId: string, toolName: string): Promise<void> {
  const [grant] = await db
    .select()
    .from(agentToolPermissionsTable)
    .where(and(eq(agentToolPermissionsTable.agentId, agentId), eq(agentToolPermissionsTable.toolName, toolName)))
    .limit(1);

  if (!grant || !grant.allowed) {
    throw new PolicyViolationError(`Agent "${agentId}" is not authorized to call tool "${toolName}".`);
  }
}

export async function grantTool(agentId: string, toolName: string, allowed = true): Promise<void> {
  const existing = await db
    .select()
    .from(agentToolPermissionsTable)
    .where(and(eq(agentToolPermissionsTable.agentId, agentId), eq(agentToolPermissionsTable.toolName, toolName)))
    .limit(1);
  if (existing[0]) {
    await db
      .update(agentToolPermissionsTable)
      .set({ allowed })
      .where(eq(agentToolPermissionsTable.id, existing[0].id));
    return;
  }
  await db.insert(agentToolPermissionsTable).values({ agentId, toolName, allowed });
}
