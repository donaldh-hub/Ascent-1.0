import { pgTable, serial, text, jsonb, timestamp, integer } from "drizzle-orm/pg-core";

export const coachWeeklySummariesTable = pgTable("coach_weekly_summaries", {
  id: serial("id").primaryKey(),
  weekStart: text("week_start").notNull(), // ISO date string of the Monday
  weekEnd: text("week_end").notNull(),
  convergenceFlags: jsonb("convergence_flags").$type<object[]>().notNull().default([]),
  pillarSummaries: jsonb("pillar_summaries").$type<object>().notNull().default({}),
  patternWatch: jsonb("pattern_watch").$type<object[]>().notNull().default([]),
  oneRecommendation: text("one_recommendation"),
  watchList: jsonb("watch_list").$type<object[]>().notNull().default([]),
  workOrderCount: integer("work_order_count").notNull().default(0),
  dataGapPrompts: jsonb("data_gap_prompts").$type<object[]>().notNull().default([]),
  rawSummaryJson: jsonb("raw_summary_json").$type<object>(),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

export type CoachWeeklySummary = typeof coachWeeklySummariesTable.$inferSelect;
