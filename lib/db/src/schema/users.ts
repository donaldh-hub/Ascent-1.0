import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * A named person inside a hub. `role` is a free-text display label
 * ("Site Manager", "Community Manager", "Regional Maintenance Manager", ...)
 * — it does not drive access on its own. What a user can see is entirely
 * determined by their rows in user_site_access.ts; role is not assumed to
 * imply "sees everything" for any title, since two hubs can use the same
 * title to mean different scopes of responsibility.
 *
 * `canManageAccess` gates whether this user may grant/revoke *other* users'
 * site access (see access-service.ts) — bounded to sites this user can
 * themselves see.
 */
export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  hubId: integer("hub_id").notNull(), // references account_status.id — the single hub for now
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role"), // display label only, e.g. "Site Manager" — not an access rule
  canManageAccess: boolean("can_manage_access").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
