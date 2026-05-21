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
  normalizeTurns,
  normalizeWorkOrders,
} from "./report-source-normalizer.js";
import type { AnalysisOutput } from "./analysis-output-contract.js";
import { analyseWorkOrders } from "./work-order-analysis-engine.js";
import { analyseTurns } from "./turn-analysis-engine.js";
import { analysePm } from "./pm-analysis-engine.js";
import { analyseAssetRisk } from "./asset-risk-analysis-engine.js";
import { analyseEvidence } from "./evidence-impact-analyzer.js";
import { analyseAssignmentCoverage } from "./assignment-coverage-analyzer.js";
import { analyseCrossCategoryPressure } from "./cross-category-pressure-analyzer.js";

import type { NormalizedReportingRecord } from "./reporting-record-contract.js";

export interface ReportingAnalysisBundle {
  workOrders: AnalysisOutput[];
  turns: AnalysisOutput[];
  pm: AnalysisOutput[];
  assets: AnalysisOutput[];
  evidence: AnalysisOutput[];
  assignments: AnalysisOutput[];
  crossCategory: AnalysisOutput[];
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
  const [workOrderRecords, turnRecords, assetRecords, documentRecords, assignmentRecords] = await Promise.all([
    normalizeWorkOrders(),
    normalizeTurns(),
    normalizeAssets(),
    normalizeDocuments(),
    normalizeAssignments(),
  ]);

  const workOrders = analyseWorkOrders(workOrderRecords);
  const turns = analyseTurns(turnRecords);
  // PM source is not yet wired in Build 7.1; the engine handles the
  // insufficient-data case correctly when passed an empty array.
  const pm = analysePm([]);
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
  const recordPool: NormalizedReportingRecord[] = [
    ...workOrderRecords,
    ...turnRecords,
    ...assetRecords,
    ...documentRecords,
    ...assignmentRecords,
  ];

  return {
    workOrders,
    turns,
    pm,
    assets,
    evidence,
    assignments,
    crossCategory,
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
