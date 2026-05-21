/**
 * Ascent 7.2 — Assignment Coverage Analyzer
 *
 * Measures how much of the ingested operational data is connected to the
 * right property / unit / asset context. Build 1.7's assignment engine
 * remains the source of truth — this analyzer only reports the resulting
 * coverage state and explains how assignment gaps reduce confidence
 * elsewhere.
 *
 * Never invents links. Only the assignment engine may create assignments.
 */

import type { NormalizedReportingRecord } from "./reporting-record-contract.js";
import {
  type AnalysisOutput,
  type ContributingFactor,
  buildReportabilityBasis,
  deriveConfidenceState,
  emptyAnalysis,
  makeAnalysisId,
} from "./analysis-output-contract.js";
import {
  computeDateRange,
  partitionByEligibility,
  summarizeMissingFields,
} from "./supporting-record-mapper.js";

const SURFACES = ["reports_page", "control_tower", "operational_health_tile", "priority_actions_panel"] as const;
const MIN_FOR_CONFIRMED = 10;

export function analyseAssignmentCoverage(records: NormalizedReportingRecord[]): AnalysisOutput[] {
  const part = partitionByEligibility(records);
  if (records.length === 0) {
    return [
      emptyAnalysis({
        analysisType: "assignment_coverage",
        sourceCategory: "assignments",
        title: "Assignment coverage",
        summary: "No assignment records have been generated yet.",
        excludedRecordCount: 0,
        compatibleSurfaces: [...SURFACES],
        recommendedReviewQuestion:
          "Upload more operational records so the assignment engine can establish coverage.",
      }),
    ];
  }

  const fullyAssigned = part.fully.length;
  const partiallyAssigned = part.partial.length;
  const unassigned = part.excluded.length;
  const total = records.length;
  const coverage = Math.round((fullyAssigned / total) * 100);
  const factors: ContributingFactor[] = [
    {
      label: "Fully assigned",
      displayValue: `${fullyAssigned} records`,
      numericValue: fullyAssigned,
      count: fullyAssigned,
      supportingRecordIds: part.fully.slice(0, 100).map((r) => r.id),
    },
    {
      label: "Partially assigned (review queue)",
      displayValue: `${partiallyAssigned} records`,
      numericValue: partiallyAssigned,
      count: partiallyAssigned,
      supportingRecordIds: part.partial.slice(0, 100).map((r) => r.id),
    },
    {
      label: "Unassigned / rejected",
      displayValue: `${unassigned} records`,
      numericValue: unassigned,
      count: unassigned,
      supportingRecordIds: part.excluded.slice(0, 100).map((r) => r.id),
    },
  ];

  const now = new Date().toISOString();
  const confidenceState = deriveConfidenceState({
    fullyReportable: fullyAssigned,
    partiallyReportable: partiallyAssigned,
    minimumFullyForConfirmed: MIN_FOR_CONFIRMED,
  });
  return [
    {
      analysisId: makeAnalysisId("assignment_coverage", "overall-coverage"),
      analysisType: "assignment_coverage",
      sourceCategory: "assignments",
      organizationId: null,
      propertyId: null,
      unitId: null,
      dateRange: computeDateRange(part.admissible),
      title: "Assignment coverage",
      summary:
        `${coverage}% of assignment records are fully resolved (${fullyAssigned} of ${total}). ` +
        `${partiallyAssigned} pending review, ${unassigned} unresolved.`,
      metricValue: coverage,
      metricUnit: "% fully assigned",
      comparisonValue: null,
      trendDirection: null,
      timeAllocationShare: null,
      estimatedTimeImpactHours: null,
      bottleneckStage: null,
      primaryCategory: null,
      contributingFactors: factors,
      confidenceState,
      reportabilityBasis: buildReportabilityBasis({
        fullyReportable: fullyAssigned,
        partiallyReportable: partiallyAssigned,
        excluded: unassigned,
      }),
      fullyReportableRecordCount: fullyAssigned,
      partiallyReportableRecordCount: partiallyAssigned,
      excludedRecordCount: unassigned,
      missingFields: summarizeMissingFields(part.admissible),
      // Cap supportingRecordIds AND supportingRecordCount together. The
      // UI promises "View N supporting records" — if N exceeded the
      // returnable set, the user would see a lie. Reviewable subset.
      supportingRecordIds: (() => {
        const sliced = [
          ...part.partial.slice(0, 100).map((r) => r.id),
          ...part.excluded.slice(0, 100).map((r) => r.id),
        ];
        return sliced;
      })(),
      supportingRecordCount: Math.min(partiallyAssigned + unassigned, 200),
      recommendedReviewQuestion:
        "Which review-queue assignments can be resolved to lift confidence across downstream analyses?",
      compatibleSurfaces: [...SURFACES],
      createdAt: now,
      updatedAt: now,
    },
  ];
}
