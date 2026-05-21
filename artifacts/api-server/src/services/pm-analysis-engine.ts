/**
 * Ascent 7.2 — Preventative Maintenance Analysis Engine
 *
 * Build 7.1 explicitly lists PM as "awaiting source data" — no PM records
 * are wired today. This engine is therefore correct-by-construction: it
 * always returns an Insufficient Data analysis until the PM ingestion is
 * wired in a later build.
 *
 * IMPORTANT: PM language MUST avoid causation. Wording like "PM gap caused
 * this work order" is forbidden — use "may be contributing", "suggests a
 * possible relationship", "review this pattern".
 */

import type { NormalizedReportingRecord } from "./reporting-record-contract.js";
import { type AnalysisOutput, emptyAnalysis, deriveConfidenceState, buildReportabilityBasis, makeAnalysisId } from "./analysis-output-contract.js";
import { computeDateRange, partitionByEligibility, summarizeMissingFields } from "./supporting-record-mapper.js";

const SURFACES = ["reports_page", "control_tower", "pm_performance_tile"] as const;
const MIN_FOR_CONFIRMED = 5;

export function analysePm(records: NormalizedReportingRecord[]): AnalysisOutput[] {
  const part = partitionByEligibility(records);
  if (part.admissible.length === 0) {
    return [
      emptyAnalysis({
        analysisType: "pm_time_allocation",
        sourceCategory: "preventative_maintenance",
        title: "PM coverage",
        summary:
          "PM analysis will activate after preventative maintenance records are ingested through Build 7.1.",
        excludedRecordCount: part.excluded.length,
        compatibleSurfaces: [...SURFACES],
        recommendedReviewQuestion:
          "Upload PM logs (property, asset where available, PM type, scheduled date) so coverage can be reviewed.",
      }),
    ];
  }

  // When PM data eventually arrives, the same finaliser pattern from the
  // work-order / turn engines applies. Today this branch is unreachable.
  const now = new Date().toISOString();
  return [
    {
      analysisId: makeAnalysisId("pm_time_allocation", "coverage"),
      analysisType: "pm_time_allocation",
      sourceCategory: "preventative_maintenance",
      organizationId: null,
      propertyId: null,
      unitId: null,
      dateRange: computeDateRange(part.admissible),
      title: "PM coverage",
      summary: `${part.admissible.length} PM record(s) admitted for analysis.`,
      metricValue: part.admissible.length,
      metricUnit: "PM records",
      comparisonValue: null,
      trendDirection: null,
      timeAllocationShare: null,
      estimatedTimeImpactHours: null,
      bottleneckStage: null,
      primaryCategory: null,
      contributingFactors: [],
      confidenceState: deriveConfidenceState({
        fullyReportable: part.fully.length,
        partiallyReportable: part.partial.length,
        minimumFullyForConfirmed: MIN_FOR_CONFIRMED,
      }),
      reportabilityBasis: buildReportabilityBasis({
        fullyReportable: part.fully.length,
        partiallyReportable: part.partial.length,
        excluded: part.excluded.length,
      }),
      fullyReportableRecordCount: part.fully.length,
      partiallyReportableRecordCount: part.partial.length,
      excludedRecordCount: part.excluded.length,
      missingFields: summarizeMissingFields(part.admissible),
      supportingRecordIds: part.admissible.map((r) => r.id),
      supportingRecordCount: part.admissible.length,
      recommendedReviewQuestion:
        "Review whether reactive work patterns may be contributing to PM coverage gaps.",
      compatibleSurfaces: [...SURFACES],
      createdAt: now,
      updatedAt: now,
    },
  ];
}
