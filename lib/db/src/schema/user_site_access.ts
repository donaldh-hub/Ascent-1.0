import { pgTable, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * The entire access model: a user can see a site if and only if there is a
 * row here for that (userId, siteId) pair. No role implies "all sites" —
 * even a user with canManageAccess only sees what's explicitly granted here.
 * `grantedByUserId` records who made the grant, for the "you can only grant
 * access to a site you yourself can see" rule enforced in access-service.ts.
 */
export const userSiteAccessTable = pgTable(
  "user_site_access",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    siteId: integer("site_id").notNull(), // references properties.id
    grantedByUserId: integer("granted_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [unique().on(table.userId, table.siteId)],
);

export type UserSiteAccess = typeof userSiteAccessTable.$inferSelect;
