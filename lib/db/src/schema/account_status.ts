import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const accountStatusTable = pgTable("account_status", {
  id: serial("id").primaryKey(),
  subscriptionStatus: text("subscription_status").notNull().default("trial"), // "trial" | "subscribed"
  trialStartedAt: timestamp("trial_started_at").notNull().defaultNow(),
  subscribedAt: timestamp("subscribed_at"),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false), // true once Jordan walkthrough + subscribe is done
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AccountStatus = typeof accountStatusTable.$inferSelect;
