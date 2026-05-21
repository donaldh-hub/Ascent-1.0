/**
 * Ascent 7.2 — Turn / Make-Ready Analysis Engine
 *
 * Uses turn language only — turn, make-ready, vacant days, stage,
 * bottleneck stage, rent-ready. Never describes a work order as a turn.
 *
 * Emits three analyses:
 *
 *   1. Bottleneck stage (which stage is slowing release)
 *   2. Vacant-days distribution (how long turns are sitting)
 *   3. Property turn-pressure (where the load is)
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

const SURFACES = ["reports_page", "control_tower", "turn_performance_tile"] as const;
const MIN_FOR_CONFIRMED = 5; // turn-data tables are typically smaller than WO

export function analyseTurns(records: NormalizedReportingRecord[]): AnalysisOutput[] {
  const part = partitionByEligibility(records);
  if (part.admissible.length === 0) {
    return [
      emptyAnalysis({
        analysisType: "turn_time_allocation",
        sourceCategory: "turns",
        title: "Turn time allocation",
        summary: "Not enough reportable turn / make-ready records to analyse make-ready time yet.",
        excludedRecordCount: part.excluded.length,
        compatibleSurfaces: [...SURFACES],
        recommendedReviewQuestion:
          "Upload complete turn records (property, unit, current stage, vacant date) to strengthen this analysis.",
      }),
    ];
  }
  return [buildBottleneckStage(part), buildVacantDays(part), buildPropertyTurnPressure(part)];
}

function buildBottleneckStage(part: ReturnType<typeof partitionByEligibility>): AnalysisOutput {
  const byStage = new Map<string, NormalizedReportingRecord[]>();
  for (const r of part.admissible) {
    const stage = (r.supportingContext?.currentStage as string | undefined)?.trim() || "Unspecified";
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage)!.push(r);
  }
  const ordered = [...byStage.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8);
  const factors: ContributingFactor[] = ordered.map(([label, rows]) => ({
    label: stageLabel(label),
    displayValue: `${rows.length} turns in this stage`,
    numericValue: rows.length,
    count: rows.length,
    supportingRecordIds: rows.map((r) => r.id),
  }));
  const top = ordered[0];

  return finalise({
    part,
    analysisId: makeAnalysisId("turn_time_allocation", "bottleneck-stage"),
    title: "Turn bottleneck stage",
    summary: top
      ? `${stageLabel(top[0])} currently holds ${top[1].length} of ${part.admissible.length} admissible turns — the most of any stage.`
      : `${part.admissible.length} turn(s) were analysed.`,
    metricValue: top ? top[1].length : null,
    metricUnit: top ? "turns" : null,
    bottleneckStage: top ? stageLabel(top[0]) : null,
    contributingFactors: factors,
    supportingRecordIds: part.admissible.map((r) => r.id),
    recommendedReviewQuestion:
      "Which turns in this stage are blocked, awaiting a contractor, or ready to be rolled forward to rent-ready?",
  });
}

function buildVacantDays(part: ReturnType<typeof partitionByEligibility>): AnalysisOutput {
  const withDays = part.admissible.filter((r) => r.ageDays != null);
  const total = withDays.length;
  const avg = total > 0 ? withDays.reduce((s, r) => s + (r.ageDays ?? 0), 0) / total : 0;
  const buckets = [
    { label: "0–14 vacant days", min: 0, max: 14 },
    { label: "15–30 vacant days", min: 15, max: 30 },
    { label: "31–60 vacant days", min: 31, max: 60 },
    { label: "61+ vacant days", min: 61, max: Number.POSITIVE_INFINITY },
  ];
  const factors: ContributingFactor[] = buckets.map((b) => {
    const rows = withDays.filter((r) => r.ageDays! >= b.min && r.ageDays! <= b.max);
    return {
      label: b.label,
      displayValue: `${rows.length} turns`,
      numericValue: rows.length,
      count: rows.length,
      supportingRecordIds: rows.map((r) => r.id),
    };
  });

  return finalise({
    part,
    analysisId: makeAnalysisId("turn_time_allocation", "vacant-days"),
    title: "Vacant days distribution",
    summary:
      total === 0
        ? "No turn records have vacant-date data — vacant days cannot be calculated."
        : `Average vacant days across ${total} admissible turn(s): ${avg.toFixed(1)} days.`,
    metricValue: total === 0 ? null : Math.round(avg * 10) / 10,
    metricUnit: total === 0 ? null : "avg vacant days",
    contributingFactors: factors,
    supportingRecordIds: withDays.map((r) => r.id),
    recommendedReviewQuestion:
      "Which long-vacant turns are at risk of extended vacancy and need an escalation?",
  });
}

function buildPropertyTurnPressure(part: ReturnType<typeof partitionByEligibility>): AnalysisOutput {
  const counts = new Map<string, NormalizedReportingRecord[]>();
  for (const r of part.admissible) {
    const key = r.propertyName?.trim() || (r.propertyId != null ? `Property #${r.propertyId}` : "Unattributed");
    if (!counts.has(key)) counts.set(key, []);
    counts.get(key)!.push(r);
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8);
  const factors: ContributingFactor[] = ordered.map(([label, rows]) => ({
    label,
    displayValue: `${rows.length} active turns`,
    numericValue: rows.length,
    count: rows.length,
    supportingRecordIds: rows.map((r) => r.id),
  }));
  const top = ordered[0];

  return finalise({
    part,
    analysisId: makeAnalysisId("turn_time_allocation", "property-turn-pressure"),
    title: "Property turn pressure",
    summary: top
      ? `${top[0]} is currently carrying ${top[1].length} active turns — the highest of any property.`
      : `${part.admissible.length} turn(s) were analysed.`,
    metricValue: top ? top[1].length : null,
    metricUnit: top ? "active turns" : null,
    contributingFactors: factors,
    supportingRecordIds: part.admissible.map((r) => r.id),
    recommendedReviewQuestion:
      "Which property's bottleneck stage is consuming the most make-ready capacity right now?",
  });
}

function stageLabel(raw: string): string {
  if (!raw) return "Unspecified";
  return raw
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function finalise(input: {
  part: ReturnType<typeof partitionByEligibility>;
  analysisId: string;
  title: string;
  summary: string;
  metricValue: number | null;
  metricUnit: string | null;
  bottleneckStage?: string | null;
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
    analysisType: "turn_time_allocation",
    sourceCategory: "turns",
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
    bottleneckStage: input.bottleneckStage ?? null,
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
