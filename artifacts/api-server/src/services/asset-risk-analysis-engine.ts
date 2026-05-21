/**
 * Ascent 7.2 — Asset / Warranty Risk-Time Analysis Engine
 *
 * Lays the analytical foundation for the future Build 9 warranty
 * intelligence. This engine intentionally stops short of Build 9 — it
 * reports exposure as it can be proven from admissible records, but it
 * does not claim warranty status the data cannot support.
 *
 * Emits two analyses:
 *
 *   1. Asset type distribution (where the inventory is concentrated)
 *   2. Out-of-warranty exposure (assets whose warrantyExpiration < today)
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

const SURFACES = ["reports_page", "control_tower", "asset_performance_tile"] as const;
const MIN_FOR_CONFIRMED = 10;

export function analyseAssetRisk(records: NormalizedReportingRecord[]): AnalysisOutput[] {
  const part = partitionByEligibility(records);
  if (part.admissible.length === 0) {
    return [
      emptyAnalysis({
        analysisType: "asset_warranty_risk",
        sourceCategory: "assets",
        title: "Asset / warranty risk",
        summary: "No admissible asset records — asset risk analysis cannot run yet.",
        excludedRecordCount: part.excluded.length,
        compatibleSurfaces: [...SURFACES],
        recommendedReviewQuestion:
          "Upload asset records (property, asset type, install date, warranty expiration) to begin risk analysis.",
      }),
    ];
  }
  return [buildAssetTypeDistribution(part), buildOutOfWarrantyExposure(part)];
}

function buildAssetTypeDistribution(part: ReturnType<typeof partitionByEligibility>): AnalysisOutput {
  const counts = new Map<string, NormalizedReportingRecord[]>();
  for (const r of part.admissible) {
    const key = r.category?.trim() || "Uncategorised";
    if (!counts.has(key)) counts.set(key, []);
    counts.get(key)!.push(r);
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8);
  const factors: ContributingFactor[] = ordered.map(([label, rows]) => ({
    label,
    displayValue: `${rows.length} assets`,
    numericValue: rows.length,
    count: rows.length,
    supportingRecordIds: rows.map((r) => r.id),
  }));
  const top = ordered[0];

  return finalise({
    part,
    analysisId: makeAnalysisId("asset_warranty_risk", "type-distribution"),
    title: "Asset type distribution",
    summary: top
      ? `${top[0]} is the largest asset category — ${top[1].length} of ${part.admissible.length} admissible assets.`
      : `${part.admissible.length} asset(s) were analysed.`,
    metricValue: top ? top[1].length : null,
    metricUnit: top ? "assets" : null,
    contributingFactors: factors,
    supportingRecordIds: part.admissible.map((r) => r.id),
    recommendedReviewQuestion:
      "Which asset categories should be reviewed for repeat work order activity in Build 9?",
  });
}

function buildOutOfWarrantyExposure(part: ReturnType<typeof partitionByEligibility>): AnalysisOutput {
  const today = Date.now();
  const withWarranty = part.admissible.filter((r) => r.dueAt != null);
  const outOfWarranty = withWarranty.filter((r) => {
    const t = r.dueAt instanceof Date ? r.dueAt.getTime() : new Date(r.dueAt!).getTime();
    return !Number.isNaN(t) && t < today;
  });
  const byProperty = new Map<string, NormalizedReportingRecord[]>();
  for (const r of outOfWarranty) {
    const key = r.propertyName?.trim() || (r.propertyId != null ? `Property #${r.propertyId}` : "Unattributed");
    if (!byProperty.has(key)) byProperty.set(key, []);
    byProperty.get(key)!.push(r);
  }
  const factors: ContributingFactor[] = [...byProperty.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 8)
    .map(([label, rows]) => ({
      label,
      displayValue: `${rows.length} out-of-warranty assets`,
      numericValue: rows.length,
      count: rows.length,
      supportingRecordIds: rows.map((r) => r.id),
    }));

  return finalise({
    part,
    analysisId: makeAnalysisId("asset_warranty_risk", "out-of-warranty-exposure"),
    title: "Out-of-warranty exposure",
    summary:
      withWarranty.length === 0
        ? "No assets carry warranty data — exposure cannot be calculated."
        : `${outOfWarranty.length} of ${withWarranty.length} admissible assets with warranty data are past expiration.`,
    metricValue: withWarranty.length === 0 ? null : outOfWarranty.length,
    metricUnit: withWarranty.length === 0 ? null : "out-of-warranty assets",
    contributingFactors: factors,
    supportingRecordIds: outOfWarranty.map((r) => r.id),
    recommendedReviewQuestion:
      "Which out-of-warranty assets are showing repeat work order activity and may warrant replacement planning?",
  });
}

function finalise(input: {
  part: ReturnType<typeof partitionByEligibility>;
  analysisId: string;
  title: string;
  summary: string;
  metricValue: number | null;
  metricUnit: string | null;
  contributingFactors: ContributingFactor[];
  supportingRecordIds: string[];
  recommendedReviewQuestion: string;
}): AnalysisOutput {
  const now = new Date().toISOString();
  const confidenceState = deriveConfidenceState({
    fullyReportable: input.part.fully.length,
    partiallyReportable: input.part.partial.length,
    minimumFullyForConfirmed: MIN_FOR_CONFIRMED,
  });
  return {
    analysisId: input.analysisId,
    analysisType: "asset_warranty_risk",
    sourceCategory: "assets",
    organizationId: null,
    propertyId: null,
    unitId: null,
    dateRange: computeDateRange(input.part.admissible),
    title: input.title,
    summary: input.summary,
    metricValue: input.metricValue,
    metricUnit: input.metricUnit,
    comparisonValue: null,
    trendDirection: null,
    timeAllocationShare: null,
    estimatedTimeImpactHours: null,
    bottleneckStage: null,
    primaryCategory: null,
    contributingFactors: input.contributingFactors,
    confidenceState,
    reportabilityBasis: buildReportabilityBasis({
      fullyReportable: input.part.fully.length,
      partiallyReportable: input.part.partial.length,
      excluded: input.part.excluded.length,
    }),
    fullyReportableRecordCount: input.part.fully.length,
    partiallyReportableRecordCount: input.part.partial.length,
    excludedRecordCount: input.part.excluded.length,
    missingFields: summarizeMissingFields(input.part.admissible),
    supportingRecordIds: input.supportingRecordIds,
    supportingRecordCount: input.supportingRecordIds.length,
    recommendedReviewQuestion: input.recommendedReviewQuestion,
    compatibleSurfaces: [...SURFACES],
    createdAt: now,
    updatedAt: now,
  };
}
