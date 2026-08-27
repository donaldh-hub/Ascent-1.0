import { db } from "@workspace/db";
import { usersTable, userSiteAccessTable, propertiesTable } from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";

export async function getAccessibleSiteIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ siteId: userSiteAccessTable.siteId })
    .from(userSiteAccessTable)
    .where(eq(userSiteAccessTable.userId, userId));
  return rows.map((r) => r.siteId);
}

export async function getUserByEmail(email: string) {
  const rows = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  return rows[0] ?? null;
}

export async function getUserById(userId: number) {
  const rows = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return rows[0] ?? null;
}

export async function createUser(input: { hubId: number; email: string; name?: string; role?: string; canManageAccess?: boolean }) {
  const inserted = await db.insert(usersTable).values(input).returning();
  return inserted[0];
}

export async function listHubUsers(hubId: number) {
  return db.select().from(usersTable).where(eq(usersTable.hubId, hubId));
}

/**
 * The whole access model in one rule: you may grant or revoke access to a
 * site only if you yourself currently have access to that site. This is
 * what lets an area manager "isolate who sees what" for their own sites
 * without a rigid org-chart hierarchy baked into the schema — the bound is
 * always "what you can see," never a fixed role.
 */
export async function grantSiteAccess({
  granterUserId,
  targetUserId,
  siteId,
}: {
  granterUserId: number;
  targetUserId: number;
  siteId: number;
}) {
  const granterSiteIds = await getAccessibleSiteIds(granterUserId);
  if (!granterSiteIds.includes(siteId)) {
    throw new AccessDeniedError("You can only grant access to a site you can see yourself.");
  }

  const existing = await db
    .select()
    .from(userSiteAccessTable)
    .where(and(eq(userSiteAccessTable.userId, targetUserId), eq(userSiteAccessTable.siteId, siteId)))
    .limit(1);
  if (existing[0]) return existing[0];

  const inserted = await db
    .insert(userSiteAccessTable)
    .values({ userId: targetUserId, siteId, grantedByUserId: granterUserId })
    .returning();
  return inserted[0];
}

export async function revokeSiteAccess({
  granterUserId,
  targetUserId,
  siteId,
}: {
  granterUserId: number;
  targetUserId: number;
  siteId: number;
}) {
  const granterSiteIds = await getAccessibleSiteIds(granterUserId);
  if (!granterSiteIds.includes(siteId)) {
    throw new AccessDeniedError("You can only revoke access to a site you can see yourself.");
  }

  await db
    .delete(userSiteAccessTable)
    .where(and(eq(userSiteAccessTable.userId, targetUserId), eq(userSiteAccessTable.siteId, siteId)));
}

export async function getAccessibleSites(userId: number) {
  const siteIds = await getAccessibleSiteIds(userId);
  if (siteIds.length === 0) return [];
  return db.select().from(propertiesTable).where(inArray(propertiesTable.id, siteIds));
}

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}
