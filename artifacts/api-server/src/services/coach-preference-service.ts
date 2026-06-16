import { db } from "@workspace/db";
import { coachPreferencesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export async function getOrCreatePreferences() {
  const rows = await db.select().from(coachPreferencesTable).limit(1);
  if (rows.length > 0) return rows[0];
  const inserted = await db.insert(coachPreferencesTable).values({}).returning();
  return inserted[0];
}

export async function updatePreferences(patch: {
  coachName?: string;
  communicationStyle?: string;
  pillarOrder?: string[];
  activationCompleted?: boolean;
}) {
  const prefs = await getOrCreatePreferences();
  const updated = await db
    .update(coachPreferencesTable)
    .set({
      ...(patch.coachName !== undefined ? { coachName: patch.coachName } : {}),
      ...(patch.communicationStyle !== undefined ? { communicationStyle: patch.communicationStyle } : {}),
      ...(patch.pillarOrder !== undefined ? { pillarOrder: patch.pillarOrder } : {}),
      ...(patch.activationCompleted !== undefined ? { activationCompleted: patch.activationCompleted } : {}),
      ...(patch.activationCompleted ? { activationCompletedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(coachPreferencesTable.id, prefs.id))
    .returning();
  return updated[0];
}
