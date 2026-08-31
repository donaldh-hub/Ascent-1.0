import { db } from "@workspace/db";
import { accountStatusTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export async function getOrCreateAccountStatus() {
  const rows = await db.select().from(accountStatusTable).limit(1);
  if (rows.length > 0) return rows[0];
  const inserted = await db.insert(accountStatusTable).values({}).returning();
  return inserted[0];
}

export async function markOnboardingCompleted() {
  const status = await getOrCreateAccountStatus();
  const updated = await db
    .update(accountStatusTable)
    .set({ onboardingCompleted: true, updatedAt: new Date() })
    .where(eq(accountStatusTable.id, status.id))
    .returning();
  return updated[0];
}

export async function subscribe() {
  const status = await getOrCreateAccountStatus();
  const updated = await db
    .update(accountStatusTable)
    .set({ subscriptionStatus: "subscribed", subscribedAt: new Date(), updatedAt: new Date() })
    .where(eq(accountStatusTable.id, status.id))
    .returning();
  return updated[0];
}

/**
 * Restores account_status to its brand-new-account defaults — trial,
 * not subscribed, onboarding not completed. App.tsx routes "/" straight
 * into the onboarding trial (upload -> Jordan -> subscribe) whenever
 * onboardingCompleted is false, so this is what actually sends a reset
 * test account back through the real first-run customer experience
 * instead of the app's normal returning-user view.
 */
export async function resetAccountStatus() {
  const status = await getOrCreateAccountStatus();
  const updated = await db
    .update(accountStatusTable)
    .set({
      subscriptionStatus: "trial",
      subscribedAt: null,
      trialStartedAt: new Date(),
      onboardingCompleted: false,
      updatedAt: new Date(),
    })
    .where(eq(accountStatusTable.id, status.id))
    .returning();
  return updated[0];
}
