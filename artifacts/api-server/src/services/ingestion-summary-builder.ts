/**
 * Ascent 7.1 — Ingestion Summary Builder
 *
 * Produces the spec §6 ingestion summary for a set of normalized records.
 * Counts only — no narrative, no UI. Used by both the per-source readiness
 * panel and the global ingestion summary endpoint.
 */

import type { NormalizedReportingRecord } from "./reporting-record-contract";

export interface IngestionSummary {
  totalRecordsReviewed: number;
  fullyReportableCount: number;
  partiallyReportableCount: number;
  notReportableCount: number;
  recordsMissingProperty: number;
  recordsMissingUnit: number;
  recordsMissingAsset: number;
  recordsMissingDates: number;
  recordsMissingStatus: number;
  recordsMissingPriority: number;
  recordsNeedingAssignmentReview: number;
  /**
   * Records that pass the **property-level** Control Tower gate (matches the
   * 1.12.7 `availableForPropertyRollup` filter — i.e. fully + partially
   * reportable). This is what the Control Tower SLA / KPI tiles see.
   */
  recordsReadyForControlTowerProperty: number;
  /**
   * Records that pass the **unit-level** reporting gate (only fully
   * reportable — i.e. unit-rollup safe). Use this for unit-grain reports
   * where individual units are the row-of-record.
   */
  recordsReadyForControlTowerUnit: number;
  /**
   * @deprecated — retained for backward compatibility with the original
   * Build 7.1 spec §6 field name. Equals `recordsReadyForControlTowerProperty`,
   * which is the gate the live Control Tower actually applies. Prefer the
   * explicit `*Property` / `*Unit` fields in new consumers.
   */
  recordsReadyForControlTower: number;
  /** All records that feed any report (= property-level gate). */
  recordsReadyForReports: number;
  recordsExcludedFromStrictValidation: number;
  generatedAt: string;
}

const has = (rec: NormalizedReportingRecord, code: string): boolean =>
  rec.reportingLimitations.some((l) => l.code === code);

export function buildIngestionSummary(records: NormalizedReportingRecord[]): IngestionSummary {
  const total = records.length;
  let fully = 0;
  let partial = 0;
  let not = 0;
  let missingProp = 0;
  let missingUnit = 0;
  let missingAsset = 0;
  let missingDates = 0;
  let missingStatus = 0;
  let missingPriority = 0;
  let needsAssignment = 0;
  let excludedStrict = 0;

  for (const r of records) {
    if (r.reportingEligibility === "fully_reportable") fully++;
    else if (r.reportingEligibility === "partially_reportable") partial++;
    else not++;

    if (has(r, "missing_property")) missingProp++;
    if (has(r, "missing_unit")) missingUnit++;
    if (has(r, "missing_asset")) missingAsset++;
    if (has(r, "missing_dates")) missingDates++;
    if (has(r, "missing_status")) missingStatus++;
    if (has(r, "missing_priority")) missingPriority++;
    if (has(r, "low_assignment_confidence")) needsAssignment++;
    if (r.reportingEligibility !== "fully_reportable") excludedStrict++;
  }

  return {
    totalRecordsReviewed: total,
    fullyReportableCount: fully,
    partiallyReportableCount: partial,
    notReportableCount: not,
    recordsMissingProperty: missingProp,
    recordsMissingUnit: missingUnit,
    recordsMissingAsset: missingAsset,
    recordsMissingDates: missingDates,
    recordsMissingStatus: missingStatus,
    recordsMissingPriority: missingPriority,
    recordsNeedingAssignmentReview: needsAssignment,
    // Control Tower today applies the 1.12.7 PROPERTY-rollup gate, so the
    // "ready for Control Tower" count must include partial+fully.
    recordsReadyForControlTowerProperty: fully + partial,
    recordsReadyForControlTowerUnit: fully,
    recordsReadyForControlTower: fully + partial, // legacy alias — see field doc
    recordsReadyForReports: fully + partial,
    recordsExcludedFromStrictValidation: excludedStrict,
    generatedAt: new Date().toISOString(),
  };
}
