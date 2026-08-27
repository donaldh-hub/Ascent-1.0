import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";

/**
 * The single paying account for this deployment — referred to as a "hub" in
 * the multi-site/multi-user access model (see users.ts, user_site_access.ts).
 * One deployment still equals one hub for now; `name` identifies the hub for
 * display once there's more than one user in it.
 */
export const accountStatusTable = pgTable("account_status", {
  id: serial("id").primaryKey(),
  name: text("name"), // the hub's display name, set once the first user signs up
  subscriptionStatus: text("subscription_status").notNull().default("trial"), // "trial" | "subscribed"
  trialStartedAt: timestamp("trial_started_at").notNull().defaultNow(),
  subscribedAt: timestamp("subscribed_at"),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false), // true once Jordan walkthrough + subscribe is done
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AccountStatus = typeof accountStatusTable.$inferSelect;
