import { inArray, type SQL, type Column } from "drizzle-orm";

/**
 * Site-scoping predicate for the core CRUD data layer (properties, units,
 * work orders, turns, assets). `accessibleSiteIds` is undefined for
 * requests with no logged-in user (existing anonymous/admin flows) — in
 * that case this returns undefined (no restriction), preserving today's
 * behavior. Once every route is required to carry a logged-in user, an
 * empty array here should mean "sees nothing," not "sees everything" —
 * that flip is intentionally NOT made yet (see PR description: root/login
 * gating is still a separate, open decision).
 */
export function siteScopeWhere(propertyIdColumn: Column, accessibleSiteIds: number[] | undefined): SQL | undefined {
  if (!accessibleSiteIds) return undefined;
  return inArray(propertyIdColumn, accessibleSiteIds);
}
