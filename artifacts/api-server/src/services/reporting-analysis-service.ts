/**
 * Ascent 7.2 — Reporting Analysis Service (Orchestrator)
 *
 * Pulls the Build 7.1 normalised reporting record set once, fans it out
 * to every per-category analysis engine, and assembles the cross-category
 * pressure analysis last (which feeds on the other engines' outputs).
 *
 * Every API endpoint and every UI surface should consume this service —
 * NOT the per-engine modules directly — so that:
 *
 *   1. The eligibility partitioning happens in one place per request.
 *   2. New engines can be added without changing route code.
 *   3. The same orchestrator can later be wrapped in a cache layer.
 */

import {
  normalizeAssets,
  normalizeAssignments,
  normalizeDocuments,
  normalizePreventativeMaintenance,
  normalizeTurns,
  normalizeWorkOrders,
} from "./report-source-normalizer.js";
import type {
  AnalysisOutput,
  TurnWorkOrderReportingModeValue,
} from "./analysis-output-contract.js";
import { analyseWorkOrders } from "./work-order-analysis-engine.js";
import { analyseTurns } from "./turn-analysis-engine.js";
import { analysePm } from "./pm-analysis-engine.js";
import { analyseAssetRisk } from "./asset-risk-analysis-engine.js";
import { analyseEvidence } from "./evidence-impact-analyzer.js";
import { analyseAssignmentCoverage } from "./assignment-coverage-analyzer.js";
import { analyseCrossCategoryPressure } from "./cross-category-pressure-analyzer.js";
import { getActiveReportingConfig } from "./reporting-config-service.js";
import { partitionWorkOrdersByTurnRelation } from "./turn-related-work-order-detector.js";
import { partitionByEligibility } from "./supporting-record-mapper.js";

import type { NormalizedReportingRecord } from "./reporting-record-contract.js";

/**
 * Ascent 7.2.1 — Mode-aware bundle summary. Exposed on every bundle so the
 * UI can show "Reporting mode: …" without a second round trip and can
 * adapt copy (Reports page, Control Tower Priority Actions) accordingly.
 */
export interface ReportingModeSummary {
  mode: TurnWorkOrderReportingModeValue;
  source: string;
  isDefault: boolean;
  nativeTurnCount: number;
  turnRelatedWorkOrderCount: number;
  needsConfirmationCount: number;
}

export interface ReportingAnalysisBundle {
  workOrders: AnalysisOutput[];
  turns: AnalysisOutput[];
  pm: AnalysisOutput[];
  assets: AnalysisOutput[];
  evidence: AnalysisOutput[];
  assignments: AnalysisOutput[];
  crossCategory: AnalysisOutput[];
  /**
   * Top-level scalar mode value. Surfaced as a string at the root of the
   * payload so the Reports page, Control Tower, narrative engine, and Build
   * Auditor can read it without descending into a nested config object.
   * Mirrors `reportingModeSummary.mode`.
   */
  reportingMode: TurnWorkOrderReportingModeValue;
  /** Rich mode metadata (counts, source, isDefault). */
  reportingModeSummary: ReportingModeSummary;
  generatedAt: string;
}

/**
 * Extended bundle that also carries the underlying NormalizedReportingRecord
 * pool used to compute the analyses. The /supporting-records endpoint uses
 * this so it can hydrate IDs back into records WITHOUT re-running every
 * source normaliser a second time (architect review fix).
 */
export interface ReportingAnalysisBundleWithRecords extends ReportingAnalysisBundle {
  recordPool: NormalizedReportingRecord[];
}

export async function runAllAnalysesWithRecords(): Promise<ReportingAnalysisBundleWithRecords> {
  const [
    active,
    workOrderRecords,
    turnRecords,
    pmRecords,
    assetRecords,
    documentRecords,
    assignmentRecords,
  ] = await Promise.all([
    getActiveReportingConfig(),
    normalizeWorkOrders(),
    normalizeTurns(),
    // Build 7.5 — PM Data Mapping Layer. PM records are a normalized view
    // over the work_orders table (no separate PM table or upload pipeline).
    normalizePreventativeMaintenance(),
    normalizeAssets(),
    normalizeDocuments(),
    normalizeAssignments(),
  ]);
  const mode = active.mode;

  // Build 7.2.1 — turn engine needs the WO admissible set to compute
  // mode-specific evidence analyses.
  const workOrders = analyseWorkOrders(workOrderRecords, { mode });
  const turns = analyseTurns(turnRecords, { mode, workOrderRecords });
  // Build 7.5 — PM analysis now consumes real mapped PM records. The engine
  // still returns the existing insufficient-data shape when no PM records
  // pass the alias filter, so prior 7.1–7.4 behavior is preserved when no
  // PM-style work orders exist in the dataset.
  const pm = analysePm(pmRecords);
  const assets = analyseAssetRisk(assetRecords);
  const evidence = analyseEvidence({
    documents: documentRecords,
    operationalRecords: [...workOrderRecords, ...turnRecords, ...assetRecords],
  });
  const assignments = analyseAssignmentCoverage(assignmentRecords);

  const crossCategory = analyseCrossCategoryPressure({
    workOrders,
    turns,
    pm,
    assets,
    evidence,
    assignments,
  });

  // Build the unified pool exactly once. Drill-down hydration reuses this
  // instead of re-normalising every source on every supporting-records hit.
  // Build 7.5 — PM records are added so PM supportingRecordIds hydrate
  // through the same /supporting-records endpoint.
  const recordPool: NormalizedReportingRecord[] = [
    ...workOrderRecords,
    ...turnRecords,
    ...pmRecords,
    ...assetRecords,
    ...documentRecords,
    ...assignmentRecords,
  ];

  const woAdmissible = partitionByEligibility(workOrderRecords).admissible;
  const turnAdmissible = partitionByEligibility(turnRecords).admissible;
  const woBreakdown = partitionWorkOrdersByTurnRelation(woAdmissible);
  const reportingModeSummary: ReportingModeSummary = {
    mode,
    source: active.config.source,
    isDefault: active.isDefault,
    nativeTurnCount: turnAdmissible.length,
    turnRelatedWorkOrderCount:
      woBreakdown.confirmed.length + woBreakdown.likely.length,
    needsConfirmationCount: woBreakdown.possible.length,
  };

  return {
    workOrders,
    turns,
    pm,
    assets,
    evidence,
    assignments,
    crossCategory,
    reportingMode: mode,
    reportingModeSummary,
    generatedAt: new Date().toISOString(),
    recordPool,
  };
}

export async function runAllAnalyses(): Promise<ReportingAnalysisBundle> {
  // Drop recordPool from the public response shape — clients don't need
  // every raw record on the /all endpoint, only the analysis outputs.
  const { recordPool: _drop, ...publicBundle } = await runAllAnalysesWithRecords();
  return publicBundle;
}

/** Collect every analysis output from a bundle into a flat array. */
export function flattenBundle(bundle: ReportingAnalysisBundle): AnalysisOutput[] {
  return [
    ...bundle.workOrders,
    ...bundle.turns,
    ...bundle.pm,
    ...bundle.assets,
    ...bundle.evidence,
    ...bundle.assignments,
    ...bundle.crossCategory,
  ];
}

/** Resolve a single analysis by id across all categories. */
export async function findAnalysisById(analysisId: string): Promise<AnalysisOutput | null> {
  const bundle = await runAllAnalyses();
  return flattenBundle(bundle).find((a) => a.analysisId === analysisId) ?? null;
}
