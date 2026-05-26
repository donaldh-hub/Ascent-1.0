/**
 * Ascent 7.5 — Preventative Maintenance Analysis Engine
 *
 * Build 7.5 turns this engine from a placeholder into the PM **Mapping
 * Readiness** layer. It does NOT compute final PM performance, PM scoring,
 * PM compliance percentages, or PM recommendations — those are explicitly
 * reserved for Build 7.6+ (spec rule: do not visually imply 7.6/7.7/7.8 PM
 * intelligence exists yet).
 *
 * What this engine DOES produce:
 *   - one AnalysisOutput summarising how many PM records were mapped,
 *     classified, and made reportable;
 *   - per-warning counts as contributingFactors so the operator can see
 *     exactly which mapping gaps need correction;
 *   - supportingRecordIds traceable to real PM records (provable via the
 *     /supporting-records endpoint).
 *
 * PM LANGUAGE RULE (spec §15): the strings here speak only PM vocabulary.
 * No turn / work-order language is mixed in.
 *
 * NO-CAUSATION RULE: PM wording avoids causal claims — "may be
 * contributing", "review this pattern", never "caused".
 */

import type { NormalizedReportingRecord } from "./reporting-record-contract.js";
import {
  type AnalysisOutput,
  type ContributingFactor,
  type CompatibleSurface,
  emptyAnalysis,
  deriveConfidenceState,
  buildReportabilityBasis,
  makeAnalysisId,
} from "./analysis-output-contract.js";
import {
  computeDateRange,
  partitionByEligibility,
  summarizeMissingFields,
} from "./supporting-record-mapper.js";
import {
  PM_CATEGORIES,
  PM_STATUSES,
  PM_WARNING_CODES,
  type PmCategory,
  type PmMappingConfidence,
  type PmStatus,
  type PmWarning,
  type PmWarningCode,
} from "./pm-mapping.js";

const SURFACES: CompatibleSurface[] = ["reports_page", "control_tower", "pm_performance_tile"];
const MIN_FOR_CONFIRMED = 5;

const PM_WARNING_LABELS: Record<PmWarningCode, string> = {
  missing_property: "Missing property match",
  missing_unit: "Missing unit match",
  missing_pm_task: "Missing PM task",
  missing_pm_category: "Missing PM category",
  pm_category_unknown: "Unknown PM category",
  missing_due_date: "Missing due date",
  missing_completed_date: "Missing completed date",
  pm_status_unknown: "Unknown PM status",
  pm_conflicting_dates: "Status / date conflict",
  pm_review_required: "Review required before reporting",
};

/** Read PM-specific structured fields the normalizer attached to a record. */
function pmContext(r: NormalizedReportingRecord): {
  category: PmCategory;
  status: PmStatus;
  confidence: PmMappingConfidence;
  warnings: PmWarning[];
} {
  const ctx = r.supportingContext as Record<string, unknown>;
  return {
    category: (ctx?.pmCategoryNormalized as PmCategory) ?? "Other",
    status: (ctx?.pmStatusNormalized as PmStatus) ?? "Unknown",
    confidence: (ctx?.pmMappingConfidence as PmMappingConfidence) ?? "low",
    warnings: Array.isArray(ctx?.pmMappingWarnings) ? (ctx.pmMappingWarnings as PmWarning[]) : [],
  };
}

export interface PmMappingSummary {
  totalMapped: number;
  fullyReportable: number;
  partiallyReportable: number;
  notReportable: number;
  fullyResolved: number;
  partiallyResolved: number;
  unresolved: number;
  mappedPropertyCount: number;
  mappedUnitCount: number;
  mappedAssetCount: number;
  unknownCategoryCount: number;
  missingDueDateCount: number;
  missingCompletedDateCount: number;
  overdueCandidateCount: number;
  recordsRequiringReviewCount: number;
  byCategory: { category: PmCategory; count: number }[];
  byStatus: { status: PmStatus; count: number }[];
  byConfidence: { confidence: PmMappingConfidence; count: number }[];
  byWarning: { code: PmWarningCode; label: string; count: number }[];
}

/**
 * Build the PM mapping summary from the normalized PM record set.
 *
 * Spec §10 — every count surfaced here MUST be derivable from the underlying
 * records so the auditor and the drill-down can prove the count.
 */
export function buildPmMappingSummary(records: NormalizedReportingRecord[]): PmMappingSummary {
  const summary: PmMappingSummary = {
    totalMapped: records.length,
    fullyReportable: 0,
    partiallyReportable: 0,
    notReportable: 0,
    fullyResolved: 0,
    partiallyResolved: 0,
    unresolved: 0,
    mappedPropertyCount: 0,
    mappedUnitCount: 0,
    mappedAssetCount: 0,
    unknownCategoryCount: 0,
    missingDueDateCount: 0,
    missingCompletedDateCount: 0,
    overdueCandidateCount: 0,
    recordsRequiringReviewCount: 0,
    byCategory: PM_CATEGORIES.map((c) => ({ category: c, count: 0 })),
    byStatus: PM_STATUSES.map((s) => ({ status: s, count: 0 })),
    byConfidence: [
      { confidence: "high", count: 0 },
      { confidence: "medium", count: 0 },
      { confidence: "low", count: 0 },
    ],
    byWarning: PM_WARNING_CODES.map((code) => ({
      code,
      label: PM_WARNING_LABELS[code],
      count: 0,
    })),
  };

  const propIds = new Set<number>();
  const unitIds = new Set<number>();
  const assetIds = new Set<number>();

  for (const r of records) {
    // Reporting eligibility distribution.
    if (r.reportingEligibility === "fully_reportable") summary.fullyReportable++;
    else if (r.reportingEligibility === "partially_reportable") summary.partiallyReportable++;
    else summary.notReportable++;

    // Resolution distribution.
    if (r.resolutionStatus === "fully_resolved") summary.fullyResolved++;
    else if (r.resolutionStatus === "partially_resolved") summary.partiallyResolved++;
    else summary.unresolved++;

    if (r.propertyId != null) propIds.add(r.propertyId);
    if (r.unitId != null) unitIds.add(r.unitId);
    if (r.assetId != null) assetIds.add(r.assetId);

    const { category, status, confidence, warnings } = pmContext(r);

    const catRow = summary.byCategory.find((b) => b.category === category);
    if (catRow) catRow.count++;
    const statusRow = summary.byStatus.find((b) => b.status === status);
    if (statusRow) statusRow.count++;
    const confRow = summary.byConfidence.find((b) => b.confidence === confidence);
    if (confRow) confRow.count++;

    if (category === "Other") summary.unknownCategoryCount++;
    if (r.dueAt == null) summary.missingDueDateCount++;
    if (r.completedAt == null && status !== "Completed") summary.missingCompletedDateCount++;
    if (status === "Overdue") summary.overdueCandidateCount++;
    if (confidence === "low") summary.recordsRequiringReviewCount++;

    for (const w of warnings) {
      const wrow = summary.byWarning.find((b) => b.code === w.code);
      if (wrow) wrow.count++;
    }
  }

  summary.mappedPropertyCount = propIds.size;
  summary.mappedUnitCount = unitIds.size;
  summary.mappedAssetCount = assetIds.size;

  return summary;
}

export function analysePm(records: NormalizedReportingRecord[]): AnalysisOutput[] {
  const part = partitionByEligibility(records);

  if (records.length === 0) {
    return [
      emptyAnalysis({
        analysisType: "pm_time_allocation",
        sourceCategory: "preventative_maintenance",
        title: "PM mapping readiness",
        summary:
          "No preventative maintenance records have been mapped yet. " +
          "Upload PM logs or inspection records to begin PM reporting readiness.",
        excludedRecordCount: 0,
        compatibleSurfaces: SURFACES,
        recommendedReviewQuestion:
          "Upload PM logs or inspection records (property, PM task or category, scheduled date) so PM mapping can begin.",
      }),
    ];
  }

  const summary = buildPmMappingSummary(records);

  // Build contributing factors — surface the warning breakdown and the
  // category breakdown so the operator can see WHY records were downgraded.
  const warningFactors: ContributingFactor[] = summary.byWarning
    .filter((w) => w.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((w) => ({
      label: w.label,
      displayValue: `${w.count} PM record(s)`,
      numericValue: w.count,
      count: w.count,
      supportingRecordIds: records
        .filter((r) =>
          pmContext(r).warnings.some((pw) => pw.code === w.code),
        )
        .map((r) => r.id),
    }));

  const categoryFactors: ContributingFactor[] = summary.byCategory
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((c) => ({
      label: `Category: ${c.category}`,
      displayValue: `${c.count} PM record(s)`,
      numericValue: c.count,
      count: c.count,
      supportingRecordIds: records
        .filter((r) => pmContext(r).category === c.category)
        .map((r) => r.id),
    }));

  const contributingFactors: ContributingFactor[] = [
    ...categoryFactors,
    ...warningFactors,
  ];

  const now = new Date().toISOString();
  return [
    {
      // Stable analysisId so the auditor and UI can find this output reliably.
      analysisId: makeAnalysisId("pm_time_allocation", "mapping_readiness"),
      analysisType: "pm_time_allocation",
      sourceCategory: "preventative_maintenance",
      organizationId: null,
      propertyId: null,
      unitId: null,
      dateRange: computeDateRange(part.admissible),
      title: "PM mapping readiness",
      summary:
        `${summary.totalMapped} PM record(s) mapped — ` +
        `${summary.fullyReportable} fully reportable, ` +
        `${summary.partiallyReportable} partially reportable, ` +
        `${summary.notReportable} not reportable yet.`,
      metricValue: summary.totalMapped,
      metricUnit: "PM records mapped",
      comparisonValue: null,
      trendDirection: null,
      timeAllocationShare: null,
      estimatedTimeImpactHours: null,
      bottleneckStage: null,
      primaryCategory: null,
      contributingFactors,
      confidenceState: deriveConfidenceState({
        fullyReportable: summary.fullyReportable,
        partiallyReportable: summary.partiallyReportable,
        minimumFullyForConfirmed: MIN_FOR_CONFIRMED,
      }),
      reportabilityBasis: buildReportabilityBasis({
        fullyReportable: summary.fullyReportable,
        partiallyReportable: summary.partiallyReportable,
        excluded: summary.notReportable,
      }),
      fullyReportableRecordCount: summary.fullyReportable,
      partiallyReportableRecordCount: summary.partiallyReportable,
      excludedRecordCount: summary.notReportable,
      missingFields: summarizeMissingFields(part.admissible),
      // Every mapped PM record is part of the proof set, including not-yet-
      // reportable ones — they are exactly what mapping readiness is about.
      supportingRecordIds: records.map((r) => r.id),
      supportingRecordCount: records.length,
      recommendedReviewQuestion:
        summary.recordsRequiringReviewCount > 0
          ? `Review ${summary.recordsRequiringReviewCount} PM record(s) flagged with low mapping confidence before relying on PM reporting.`
          : "Review PM mapping warnings to improve PM reporting readiness.",
      compatibleSurfaces: SURFACES,
      reportingModeUsed: "hybrid_or_unknown",
      turnRelatedBreakdown: null,
      recordInclusionMetadata: Object.fromEntries(
        records.map((r) => {
          const { category, status, confidence, warnings } = pmContext(r);
          return [
            r.id,
            {
              recordType: "other" as const,
              inclusionReason:
                `PM record (category: ${category}, status: ${status}, ` +
                `mapping confidence: ${confidence}` +
                (warnings.length > 0
                  ? `; warnings: ${warnings.map((w) => w.code).join(", ")}`
                  : "") +
                `).`,
            },
          ];
        }),
      ),
      createdAt: now,
      updatedAt: now,
    },
  ];
}
