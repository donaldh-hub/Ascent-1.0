import { pgTable, serial, text, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";

export const coachPreferencesTable = pgTable("coach_preferences", {
  id: serial("id").primaryKey(),
  coachName: text("coach_name").notNull().default("Jordan"),
  communicationStyle: text("communication_style").notNull().default("bullets"), // "bullets" | "narrative" | "mixed"
  pillarOrder: jsonb("pillar_order").$type<string[]>().notNull().default(["work_orders", "turns", "compliance", "pm_warranty"]),
  activationCompleted: boolean("activation_completed").notNull().default(false),
  activationCompletedAt: timestamp("activation_completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type CoachPreferences = typeof coachPreferencesTable.$inferSelect;
export type InsertCoachPreferences = typeof coachPreferencesTable.$inferInsert;
