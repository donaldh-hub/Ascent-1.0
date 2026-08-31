import { db } from "@workspace/db";
import { reportsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export async function getOrCreateReportForSession(sessionToken: string, siteName?: string) {
  const existing = await db.select().from(reportsTable).where(eq(reportsTable.sessionToken, sessionToken)).limit(1);
  if (existing.length > 0) return existing[0];

  const inserted = await db
    .insert(reportsTable)
    .values({
      sessionToken,
      shareToken: randomUUID(),
      siteName: siteName ?? null,
    })
    .returning();
  return inserted[0];
}

export async function incrementUploadCount(sessionToken: string) {
  const report = await getOrCreateReportForSession(sessionToken);
  const updated = await db
    .update(reportsTable)
    .set({ uploadCount: report.uploadCount + 1, lastUploadAt: new Date() })
    .where(eq(reportsTable.id, report.id))
    .returning();
  return updated[0];
}

/**
 * Resets the free-upload gate for the given session. The gate
 * (POST /upload/work-orders checking report.uploadCount) is tracked here,
 * entirely separately from properties/work-orders/turns — a full data
 * reset for a fresh test run does not touch this table, so the gate stays
 * tripped from an earlier upload even after the rest of the account looks
 * empty. This is that missing reset step.
 */
export async function resetUploadCountForSession(sessionToken: string) {
  const report = await getOrCreateReportForSession(sessionToken);
  const updated = await db
    .update(reportsTable)
    .set({ uploadCount: 0 })
    .where(eq(reportsTable.id, report.id))
    .returning();
  return updated[0];
}

export async function getReportByShareToken(shareToken: string) {
  const rows = await db.select().from(reportsTable).where(eq(reportsTable.shareToken, shareToken)).limit(1);
  return rows[0] ?? null;
}
