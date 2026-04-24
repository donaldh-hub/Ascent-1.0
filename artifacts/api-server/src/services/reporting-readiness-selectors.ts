/**
 * Ascent 7.1 — Reporting Readiness Selectors
 *
 * Per-source rollup used by the Reporting Readiness panel. One row per source
 * type with: total / fully / partial / not / coverage% / top missing fields /
 * recommended next action / low-data message.
 */

import type { NormalizedReportingRecord, ReportingSourceType } from "./reporting-record-contract";
import { REPORTING_SOURCE_REGISTRY, listAllSourceDefinitions } from "./reporting-source-registry";

export interface ReadinessRow {
  sourceType: ReportingSourceType;
  displayName: string;
  isWiredToday: boolean;
  totalRecords: number;
  fullyReportable: number;
  partiallyReportable: number;
  notReportable: number;
  coveragePercent: number;
  topMissingFields: { code: string; count: number }[];
  recommendedNextAction: string;
  lowDataMessage: string;
}

function recommend(row: Omit<ReadinessRow, "recommendedNextAction" | "lowDataMessage">): string {
  if (!row.isWiredToday && row.totalRecords === 0) {
    return "Upload source data to activate this report family.";
  }
  if (row.totalRecords === 0) {
    return "No records yet — confirm source ingestion is connected.";
  }
  if (row.notReportable > 0) {
    return `Resolve ${row.notReportable} unmatched record(s) to bring them into reporting.`;
  }
  if (row.partiallyReportable > 0) {
    return `Confirm unit/context for ${row.partiallyReportable} partial record(s) to enable unit-level reporting.`;
  }
  return "Reporting is fully covered for this source.";
}

export function buildReadinessRow(
  sourceType: ReportingSourceType,
  records: NormalizedReportingRecord[],
): ReadinessRow {
  const def = REPORTING_SOURCE_REGISTRY[sourceType];
  const total = records.length;
  let fully = 0;
  let partial = 0;
  let not = 0;
  const limCounts = new Map<string, number>();
  for (const r of records) {
    if (r.reportingEligibility === "fully_reportable") fully++;
    else if (r.reportingEligibility === "partially_reportable") partial++;
    else not++;
    for (const l of r.reportingLimitations) {
      limCounts.set(l.code, (limCounts.get(l.code) ?? 0) + 1);
    }
  }
  const topMissing = Array.from(limCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([code, count]) => ({ code, count }));

  const base: Omit<ReadinessRow, "recommendedNextAction" | "lowDataMessage"> = {
    sourceType,
    displayName: def.displayName,
    isWiredToday: def.isWiredToday,
    totalRecords: total,
    fullyReportable: fully,
    partiallyReportable: partial,
    notReportable: not,
    coveragePercent: total === 0 ? 0 : Math.round((fully / total) * 100),
    topMissingFields: topMissing,
  };

  return {
    ...base,
    recommendedNextAction: recommend(base),
    lowDataMessage: def.lowDataMessage,
  };
}

export function buildAllReadinessRows(
  recordsBySource: Map<ReportingSourceType, NormalizedReportingRecord[]>,
): ReadinessRow[] {
  return listAllSourceDefinitions().map((def) =>
    buildReadinessRow(def.sourceType, recordsBySource.get(def.sourceType) ?? []),
  );
}
