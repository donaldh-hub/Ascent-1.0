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
