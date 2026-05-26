/**
 * Ascent 7.1 — Reporting Ingestion Orchestrator
 *
 * Top-level façade. Pulls every wired source through its normalizer, applies
 * the eligibility classifier, and produces both per-source readiness rows and
 * a global ingestion summary. The Reporting Readiness UI and the future
 * Build 7 reporting spine read from here.
 *
 * Modes:
 *   "flexible" (default) — accept records as-is; downstream consumers respect
 *                          eligibility classifications.
 *   "strict"             — fail validation if any wired source has zero fully-
 *                          reportable records OR if specific source has > 0
 *                          unresolved records (used for wiring audits).
 */

import type { ReportingSourceType, NormalizedReportingRecord } from "./reporting-record-contract";
import { listAllSourceDefinitions } from "./reporting-source-registry";
import { normalizeBySource } from "./report-source-normalizer";
import { buildIngestionSummary, type IngestionSummary } from "./ingestion-summary-builder";
import {
  buildAllReadinessRows,
  buildReadinessRow,
  type ReadinessRow,
} from "./reporting-readiness-selectors";

/**
 * Build 7.5 — derived-view sources MUST NOT inflate the global ingestion
 * summary. `preventative_maintenance` records are re-emitted from
 * `work_orders` rows under a distinct sourceType / id namespace so PM gets
 * its own readiness row and PM-only drill-downs, but the underlying raw row
 * is already counted under `work_orders`. Including PM in the global
 * `allRecords` pool would inflate Build 7.4's locked tiles
 * (`totalRecordsReviewed`, `fullyReportableCount`, etc.) by exactly the PM
 * count — silently the first time a PM-style work order is loaded. The set
 * below explicitly lists derived views to skip when assembling the global
 * summary; each per-source readiness row is unaffected.
 */
const DERIVED_VIEW_SOURCES: ReadonlySet<ReportingSourceType> = new Set<ReportingSourceType>([
  "preventative_maintenance",
]);

export type IngestionMode = "flexible" | "strict";

export interface ReportingIngestionResult {
  mode: IngestionMode;
  generatedAt: string;
  summary: IngestionSummary;
  readiness: ReadinessRow[];
  strictValidation: StrictValidationResult | null;
}

export interface StrictValidationResult {
  passed: boolean;
  totalSourcesChecked: number;
  sourcesWithIssues: { sourceType: ReportingSourceType; reason: string }[];
}

async function loadAllSources(): Promise<Map<ReportingSourceType, NormalizedReportingRecord[]>> {
  const defs = listAllSourceDefinitions();
  const entries = await Promise.all(
    defs.map(async (d) => [d.sourceType, await normalizeBySource(d.sourceType)] as const),
  );
  return new Map(entries);
}

function runStrictValidation(
  recordsBySource: Map<ReportingSourceType, NormalizedReportingRecord[]>,
): StrictValidationResult {
  const issues: StrictValidationResult["sourcesWithIssues"] = [];
  const wired = listAllSourceDefinitions().filter((d) => d.isWiredToday);

  for (const def of wired) {
    const records = recordsBySource.get(def.sourceType) ?? [];
    const fully = records.filter((r) => r.reportingEligibility === "fully_reportable").length;
    const not = records.filter((r) => r.reportingEligibility === "not_reportable").length;
    if (records.length === 0) {
      issues.push({ sourceType: def.sourceType, reason: "No records ingested." });
    } else if (fully === 0) {
      issues.push({ sourceType: def.sourceType, reason: "No fully reportable records." });
    } else if (not > 0) {
      issues.push({
        sourceType: def.sourceType,
        reason: `${not} unmatched record(s) require manual resolution.`,
      });
    }
  }

  return {
    passed: issues.length === 0,
    totalSourcesChecked: wired.length,
    sourcesWithIssues: issues,
  };
}

export async function runReportingIngestion(opts: { mode?: IngestionMode } = {}): Promise<ReportingIngestionResult> {
  const mode: IngestionMode = opts.mode ?? "flexible";
  const recordsBySource = await loadAllSources();

  // Build 7.5 — skip derived views (PM) so the locked 7.4 summary tiles do
  // not double-count records that are already represented under their raw
  // source (work_orders). Readiness still receives the full map below.
  const allRecords: NormalizedReportingRecord[] = [];
  for (const [sourceType, arr] of recordsBySource.entries()) {
    if (DERIVED_VIEW_SOURCES.has(sourceType)) continue;
    allRecords.push(...arr);
  }

  const summary = buildIngestionSummary(allRecords);
  const readiness = buildAllReadinessRows(recordsBySource);
  const strictValidation = mode === "strict" ? runStrictValidation(recordsBySource) : null;

  return {
    mode,
    generatedAt: new Date().toISOString(),
    summary,
    readiness,
    strictValidation,
  };
}

/** Records for a single source — used by drill-down endpoints. */
export async function loadRecordsForSource(
  sourceType: ReportingSourceType,
  filters: { eligibility?: NormalizedReportingRecord["reportingEligibility"] } = {},
): Promise<{ readiness: ReadinessRow; records: NormalizedReportingRecord[] }> {
  const records = await normalizeBySource(sourceType);
  const readiness = buildReadinessRow(sourceType, records);
  const filtered = filters.eligibility
    ? records.filter((r) => r.reportingEligibility === filters.eligibility)
    : records;
  return { readiness, records: filtered };
}
