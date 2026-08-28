/**
 * Narrow, deliberately conservative enforcement of Intelligence-Quality's
 * release decisions (PR #13's data-ingestion-agent/intelligence-quality-
 * agent). Scoped to Jordan's tools only for this increment — see
 * jordan-tools.ts and the PR description for why: Control Tower,
 * dashboards, and reports still read unfiltered, and wiring them is a
 * deliberately separate, larger change.
 *
 * Only EXPLICITLY blocked batches are filtered out. A record whose batch
 * was never evaluated (imported before this agent build existed, or
 * through a path that predates quality_release_decisions) is NOT held
 * back — there is no decision to enforce for it, so nothing changes.
 * This never invents a block for data that simply hasn't been checked;
 * it only ever removes data known to have failed a real check.
 */
import { db } from "@workspace/db";
import { qualityReleaseDecisionsTable } from "@workspace/db/schema";
import { eq, isNull, notInArray, or, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

export async function getBlockedBatchIds(): Promise<string[]> {
  const rows = await db
    .select({ batchId: qualityReleaseDecisionsTable.batchId })
    .from(qualityReleaseDecisionsTable)
    .where(eq(qualityReleaseDecisionsTable.decision, "blocked"));
  return [...new Set(rows.map((r) => r.batchId))];
}

/**
 * A WHERE fragment excluding rows from any blocked batch, or undefined if
 * there's nothing to exclude — callers should skip adding it to their
 * `and(...)` list entirely in that case. Handles the SQL NULL trap
 * explicitly: `import_batch_id NOT IN (...)` alone would silently exclude
 * every row with a NULL importBatchId too, since NULL comparisons never
 * evaluate true — those rows have no batch to have been blocked, so they
 * must stay included.
 */
export function excludeBlockedBatches(
  importBatchIdColumn: PgColumn,
  blockedBatchIds: string[],
): SQL | undefined {
  if (blockedBatchIds.length === 0) return undefined;
  return or(isNull(importBatchIdColumn), notInArray(importBatchIdColumn, blockedBatchIds));
}
