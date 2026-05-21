/**
 * Ascent 7.2 — Work Order Analysis Engine
 *
 * Produces analysis outputs about WHERE work-order time is going. Only
 * admissible records (fully + partially reportable) feed the analysis.
 * Confidence is downgraded automatically when partials are mixed in.
 *
 * Emits four analyses:
 *
 *   1. Top categories (where time is concentrated)
 *   2. Aging buckets (which work orders are sitting)
 *   3. Property pressure (which properties carry the load)
 *   4. Unit repeat demand (which units have multiple open WOs)
 *
 * NEVER uses turn language. NEVER treats WO category as a PM category.
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

const SURFACES = ["reports_page", "control_tower", "work_order_performance_tile"] as const;
const MIN_FOR_CONFIRMED = 10; // industry-typical floor for category-share analyses

export function analyseWorkOrders(records: NormalizedReportingRecord[]): AnalysisOutput[] {
  const part = partitionByEligibility(records);
  const admissible = part.admissible;

  // If there is nothing admissible, return a single insufficient-data output
  // so the Reports page renders the honest empty state instead of nothing.
  if (admissible.length === 0) {
    return [
      emptyAnalysis({
        analysisType: "work_order_time_allocation",
        sourceCategory: "work_orders",
        title: "Work order time allocation",
        summary: "Not enough reportable work orders to analyse time allocation yet.",
        excludedRecordCount: part.excluded.length,
        compatibleSurfaces: [...SURFACES],
        recommendedReviewQuestion:
          "Upload more complete work order records (property, unit, category, dates) to strengthen this analysis.",
      }),
    ];
  }

  return [
    buildTopCategories(part),
    buildAgingBuckets(part),
    buildPropertyPressure(part),
    buildUnitRepeatDemand(part),
  ];
}

// ─── 1. Top categories ───────────────────────────────────────────────────────

function buildTopCategories(part: ReturnType<typeof partitionByEligibility>): AnalysisOutput {
  const admissible = part.admissible;
  const total = admissible.length;
  const counts = new Map<string, NormalizedReportingRecord[]>();
  for (const r of admissible) {
    const key = r.category?.trim() || "Uncategorised";
    if (!counts.has(key)) counts.set(key, []);
    counts.get(key)!.push(r);
  }
  const ordered = [...counts.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 8);
  const factors: ContributingFactor[] = ordered.map(([label, rows]) => ({
    label,
    displayValue: `${rows.length} work orders (${Math.round((rows.length / total) * 100)}%)`,
    numericValue: rows.length,
    count: rows.length,
    supportingRecordIds: rows.map((r) => r.id),
  }));
  const top = ordered[0];

  return finalise({
    part,
    analysisId: makeAnalysisId("work_order_time_allocation", "top-categories"),
    title: "Top work order categories",
    summary: top
      ? `${top[0]} accounts for ${top[1].length} of ${total} admissible work orders (${Math.round((top[1].length / total) * 100)}%).`
      : `${total} work orders were analysed.`,
    metricValue: top ? top[1].length : null,
    metricUnit: top ? "work orders" : null,
    primaryCategory: top ? top[0] : null,
    contributingFactors: factors,
    minFloor: MIN_FOR_CONFIRMED,
    supportingRecordIds: admissible.map((r) => r.id),
    recommendedReviewQuestion:
      "Which work-order categories should be prioritised, and which suggest a recurring underlying asset issue worth a separate review?",
  });
}

// ─── 2. Aging buckets ────────────────────────────────────────────────────────

function buildAgingBuckets(part: ReturnType<typeof partitionByEligibility>): AnalysisOutput {
  const withAge = part.admissible.filter((r) => r.ageDays != null);
  const total = withAge.length;
  const buckets = [
    { label: "0–7 days", min: 0, max: 7 },
    { label: "8–30 days", min: 8, max: 30 },
    { label: "31–60 days", min: 31, max: 60 },
    { label: "61+ days", min: 61, max: Number.POSITIVE_INFINITY },
  ];
  const factors: ContributingFactor[] = buckets.map((b) => {
    const rows = withAge.filter((r) => r.ageDays != null && r.ageDays >= b.min && r.ageDays <= b.max);
    return {
      label: b.label,
      displayValue: `${rows.length} work orders`,
      numericValue: rows.length,
      count: rows.length,
      supportingRecordIds: rows.map((r) => r.id),
    };
  });
  const aged = factors.slice(2).reduce((sum, f) => sum + f.numericValue, 0);

  return finalise({
    part,
    analysisId: makeAnalysisId("work_order_time_allocation", "aging-buckets"),
    title: "Work order aging",
    summary:
      total === 0
        ? "No work orders have date fields available — aging cannot be calculated."
        : `${aged} of ${total} work orders have been open longer than 30 days.`,
    metricValue: total === 0 ? null : aged,
    metricUnit: total === 0 ? null : "aged work orders",
    contributingFactors: factors,
    minFloor: MIN_FOR_CONFIRMED,
    supportingRecordIds: withAge.map((r) => r.id),
    recommendedReviewQuestion:
      "Which aged work orders should be escalated, reassigned, or closed before they exit Build 7.1's reportable window?",
  });
}

// ─── 3. Property pressure ────────────────────────────────────────────────────

function buildPropertyPressure(part: ReturnType<typeof partitionByEligibility>): AnalysisOutput {
  const total = part.admissible.length;
  const counts = new Map<string, NormalizedReportingRecord[]>();
  for (const r of part.admissible) {
    const key = r.propertyName?.trim() || (r.propertyId != null ? `Property #${r.propertyId}` : "Unattributed");
    if (!counts.has(key)) counts.set(key, []);
    counts.get(key)!.push(r);
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8);
  const factors: ContributingFactor[] = ordered.map(([label, rows]) => ({
    label,
    displayValue: `${rows.length} work orders (${Math.round((rows.length / total) * 100)}%)`,
    numericValue: rows.length,
    count: rows.length,
    supportingRecordIds: rows.map((r) => r.id),
  }));
  const top = ordered[0];

  return finalise({
    part,
    analysisId: makeAnalysisId("work_order_time_allocation", "property-pressure"),
    title: "Property work-order pressure",
    summary: top
      ? `${top[0]} is carrying ${top[1].length} admissible work orders (${Math.round((top[1].length / total) * 100)}% of total).`
      : `${total} work orders were analysed.`,
    metricValue: top ? top[1].length : null,
    metricUnit: top ? "work orders" : null,
    contributingFactors: factors,
    minFloor: MIN_FOR_CONFIRMED,
    supportingRecordIds: part.admissible.map((r) => r.id),
    recommendedReviewQuestion:
      "Is this property facing a real surge in demand, or are unresolved assignments inflating its share?",
  });
}

// ─── 4. Unit repeat demand ───────────────────────────────────────────────────

function buildUnitRepeatDemand(part: ReturnType<typeof partitionByEligibility>): AnalysisOutput {
  const byUnit = new Map<string, NormalizedReportingRecord[]>();
  for (const r of part.admissible) {
    if (r.unitId == null) continue;
    const key = `${r.propertyName ?? "?"} • ${r.unitNameOrNumber ?? `Unit #${r.unitId}`}`;
    if (!byUnit.has(key)) byUnit.set(key, []);
    byUnit.get(key)!.push(r);
  }
  const repeated = [...byUnit.entries()]
    .filter(([, rows]) => rows.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10);
  const factors: ContributingFactor[] = repeated.map(([label, rows]) => ({
    label,
    displayValue: `${rows.length} repeat work orders`,
    numericValue: rows.length,
    count: rows.length,
    supportingRecordIds: rows.map((r) => r.id),
  }));
  const total = repeated.reduce((sum, [, rows]) => sum + rows.length, 0);

  return finalise({
    part,
    analysisId: makeAnalysisId("work_order_time_allocation", "unit-repeat-demand"),
    title: "Units with repeat work-order demand",
    summary:
      repeated.length === 0
        ? "No units show repeat demand in the admissible record set."
        : `${repeated.length} unit(s) have multiple open or recent work orders (${total} records total).`,
    metricValue: repeated.length,
    metricUnit: "units with repeat demand",
    contributingFactors: factors,
    minFloor: MIN_FOR_CONFIRMED,
    supportingRecordIds: repeated.flatMap(([, rows]) => rows.map((r) => r.id)),
    recommendedReviewQuestion:
      "Do repeat demands point to a specific asset, contractor, or PM gap that should be reviewed?",
  });
}

// ─── shared finaliser ────────────────────────────────────────────────────────

function finalise(input: {
  part: ReturnType<typeof partitionByEligibility>;
  analysisId: string;
  title: string;
  summary: string;
  metricValue: number | null;
  metricUnit: string | null;
  contributingFactors: ContributingFactor[];
  minFloor: number;
  supportingRecordIds: string[];
  recommendedReviewQuestion: string;
  primaryCategory?: string | null;
}): AnalysisOutput {
  const { part } = input;
  const now = new Date().toISOString();
  const confidenceState = deriveConfidenceState({
    fullyReportable: part.fully.length,
    partiallyReportable: part.partial.length,
    minimumFullyForConfirmed: input.minFloor,
  });
  return {
    analysisId: input.analysisId,
    analysisType: "work_order_time_allocation",
    sourceCategory: "work_orders",
    organizationId: null,
    propertyId: null,
    unitId: null,
    dateRange: computeDateRange(part.admissible),
    title: input.title,
    summary: input.summary,
    metricValue: input.metricValue,
    metricUnit: input.metricUnit,
    comparisonValue: null,
    trendDirection: null,
    timeAllocationShare: null,
    estimatedTimeImpactHours: null,
    bottleneckStage: null,
    primaryCategory: input.primaryCategory ?? null,
    contributingFactors: input.contributingFactors,
    confidenceState,
    reportabilityBasis: buildReportabilityBasis({
      fullyReportable: part.fully.length,
      partiallyReportable: part.partial.length,
      excluded: part.excluded.length,
    }),
    fullyReportableRecordCount: part.fully.length,
    partiallyReportableRecordCount: part.partial.length,
    excludedRecordCount: part.excluded.length,
    missingFields: summarizeMissingFields(part.admissible),
    supportingRecordIds: input.supportingRecordIds,
    supportingRecordCount: input.supportingRecordIds.length,
    recommendedReviewQuestion: input.recommendedReviewQuestion,
    compatibleSurfaces: [...SURFACES],
    createdAt: now,
    updatedAt: now,
  };
}
