/**
 * Ascent 7.2 — Supporting Record Mapper
 *
 * Bridges analysis outputs back to the underlying Build 7.1
 * NormalizedReportingRecord set. Every signal an analysis engine emits
 * must be provable — clicking it returns the same record subset that fed
 * the conclusion.
 *
 * This mapper does two things:
 *
 *   1. Partitions a record set by eligibility (fully / partial / excluded)
 *      so engines can compute confidence consistently.
 *   2. Hydrates supporting record IDs back into full NormalizedReportingRecord
 *      objects on demand (used by the /supporting-records endpoint).
 */

import type { NormalizedReportingRecord } from "./reporting-record-contract.js";
import {
  normalizeWorkOrders,
  normalizeTurns,
  normalizeAssets,
  normalizeDocuments,
  normalizeAssignments,
} from "./report-source-normalizer.js";

export interface EligibilityPartition {
  fully: NormalizedReportingRecord[];
  partial: NormalizedReportingRecord[];
  excluded: NormalizedReportingRecord[];
  /** Records that are reportable in any tier (fully ∪ partial). */
  admissible: NormalizedReportingRecord[];
}

export function partitionByEligibility(
  records: NormalizedReportingRecord[],
): EligibilityPartition {
  const fully: NormalizedReportingRecord[] = [];
  const partial: NormalizedReportingRecord[] = [];
  const excluded: NormalizedReportingRecord[] = [];
  for (const r of records) {
    if (r.reportingEligibility === "fully_reportable") fully.push(r);
    else if (r.reportingEligibility === "partially_reportable") partial.push(r);
    else excluded.push(r);
  }
  return { fully, partial, excluded, admissible: [...fully, ...partial] };
}

/**
 * Aggregate distinct limitation codes across a record set, ordered by
 * frequency. Engines surface this as `missingFields` so the user can see
 * which gaps weakened the analysis.
 */
export function summarizeMissingFields(records: NormalizedReportingRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    for (const l of r.reportingLimitations) {
      counts.set(l.code, (counts.get(l.code) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code]) => code);
}

/**
 * Hydrate a list of supporting record IDs back into full records using an
 * IN-MEMORY record set that has ALREADY been normalised once for this
 * request. Critically, this avoids re-running every source normaliser a
 * second time on every drill-down click — the orchestrator computes the
 * record set once and passes it down.
 *
 * IDs use Build 7.1's "<source>:<sourceRecordId>" format.
 */
export function loadSupportingRecordsFromPool(
  ids: string[],
  pool: NormalizedReportingRecord[],
): NormalizedReportingRecord[] {
  if (ids.length === 0) return [];
  const wanted = new Set(ids);
  return pool.filter((r) => wanted.has(r.id));
}

/**
 * Standalone hydration kept for callers that don't have a record pool
 * already (e.g. ad-hoc tools). The /supporting-records route does NOT use
 * this — it uses loadSupportingRecordsFromPool with the bundle's own
 * records to avoid the duplicate-normalisation cost the architect flagged.
 */
export async function loadSupportingRecords(ids: string[]): Promise<NormalizedReportingRecord[]> {
  if (ids.length === 0) return [];
  const bySource = new Map<string, Set<string>>();
  for (const id of ids) {
    const [source] = id.split(":");
    if (!source) continue;
    if (!bySource.has(source)) bySource.set(source, new Set());
    bySource.get(source)!.add(id);
  }
  const buckets: NormalizedReportingRecord[][] = [];
  await Promise.all(
    [...bySource.entries()].map(async ([source, idSet]) => {
      const all = await loadAllForSource(source);
      buckets.push(all.filter((r) => idSet.has(r.id)));
    }),
  );
  return buckets.flat();
}

async function loadAllForSource(source: string): Promise<NormalizedReportingRecord[]> {
  switch (source) {
    case "work_orders": return normalizeWorkOrders();
    case "turns": return normalizeTurns();
    case "assets": return normalizeAssets();
    case "documents": return normalizeDocuments();
    case "assignments": return normalizeAssignments();
    default: return [];
  }
}

/** Compute the inclusive date range covered by a set of records. */
export function computeDateRange(records: NormalizedReportingRecord[]): {
  startIso: string | null;
  endIso: string | null;
} {
  let minMs: number | null = null;
  let maxMs: number | null = null;
  for (const r of records) {
    const opened = r.openedAt instanceof Date ? r.openedAt : r.openedAt ? new Date(r.openedAt) : null;
    if (opened && !Number.isNaN(opened.getTime())) {
      const ms = opened.getTime();
      if (minMs === null || ms < minMs) minMs = ms;
      if (maxMs === null || ms > maxMs) maxMs = ms;
    }
  }
  return {
    startIso: minMs === null ? null : new Date(minMs).toISOString(),
    endIso: maxMs === null ? null : new Date(maxMs).toISOString(),
  };
}
