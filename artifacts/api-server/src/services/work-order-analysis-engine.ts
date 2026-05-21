/**
 * Ascent 7.2 → 7.2.1 — Work Order Analysis Engine
 *
 * Produces analysis outputs about WHERE work-order time is going. Only
 * admissible records (fully + partially reportable) feed the analysis.
 * Confidence is downgraded automatically when partials are mixed in.
 *
 * Emits four base analyses:
 *
 *   1. Top categories (where time is concentrated)
 *   2. Aging buckets (which work orders are sitting)
 *   3. Property pressure (which properties carry the load)
 *   4. Unit repeat demand (which units have multiple open WOs)
 *
 * Build 7.2.1 — Mode awareness
 *
 * The active Turn / Work Order Reporting Mode reshapes how the engine
 * speaks (NOT how it counts) and adds mode-specific analyses:
 *
 *   - separate_turns_and_work_orders: emit base 4 only; "Turn" category
 *     is treated as just another imported WO category and labelled as
 *     such (never as a turn).
 *   - work_orders_measure_turn_progress: emit base 4 PLUS an explicit
 *     "Turn-Related Work Orders" analysis so the operator can see the
 *     turn-progress signal that the WO data is acting as a proxy for.
 *   - hybrid_or_unknown: emit base 4 PLUS a "Potential Turn-Related
 *     Work Orders" analysis covering possible_turn_related records that
 *     still need confirmation.
 *
 * NEVER merges WOs into turns — the analyses are sibling outputs the UI
 * groups under the work-order section.
 */

import type { NormalizedReportingRecord } from "./reporting-record-contract.js";
import {
  type AnalysisOutput,
  type ContributingFactor,
  type RecordInclusionEntry,
  type TurnRelatedBreakdown,
  type TurnWorkOrderReportingModeValue,
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
import {
  detectTurnRelation,
  partitionWorkOrdersByTurnRelation,
} from "./turn-related-work-order-detector.js";

const SURFACES = ["reports_page", "control_tower", "work_order_performance_tile"] as const;
const MIN_FOR_CONFIRMED = 10; // industry-typical floor for category-share analyses

export interface WorkOrderAnalysisOptions {
  mode: TurnWorkOrderReportingModeValue;
}

export function analyseWorkOrders(
  records: NormalizedReportingRecord[],
  opts: WorkOrderAnalysisOptions = { mode: "hybrid_or_unknown" },
): AnalysisOutput[] {
  const part = partitionByEligibility(records);
  const admissible = part.admissible;
  const mode = opts.mode;

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
        reportingModeUsed: mode,
      }),
    ];
  }

  const base: AnalysisOutput[] = [
    buildTopCategories(part, mode),
    buildAgingBuckets(part, mode),
    buildPropertyPressure(part, mode),
    buildUnitRepeatDemand(part, mode),
  ];

  // Mode-specific extras
  const breakdown = partitionWorkOrdersByTurnRelation(admissible);
  if (mode === "work_orders_measure_turn_progress") {
    const turnRelated = [...breakdown.confirmed, ...breakdown.likely];
    if (turnRelated.length > 0) {
      base.push(buildTurnRelatedWorkOrders(part, turnRelated, breakdown.possible.length, mode));
    }
  } else if (mode === "hybrid_or_unknown") {
    if (breakdown.possible.length > 0) {
      base.push(buildPotentialTurnRelatedWorkOrders(part, breakdown.possible, mode));
    }
  }

  return base;
}

// ─── 1. Top categories ───────────────────────────────────────────────────────

function buildTopCategories(
  part: ReturnType<typeof partitionByEligibility>,
  mode: TurnWorkOrderReportingModeValue,
): AnalysisOutput {
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
    // SEPARATE mode: explicitly label "Turn" as an imported WO category
    // so the operator never confuses it with the native Turns analysis.
    label: mode === "separate_turns_and_work_orders" && isTurnyCategory(label)
      ? `${label} (imported work order category)`
      : label,
    displayValue: `${rows.length} work orders (${Math.round((rows.length / total) * 100)}%)`,
    numericValue: rows.length,
    count: rows.length,
    supportingRecordIds: rows.map((r) => r.id),
  }));
  const top = ordered[0];

  return finalise({
    part,
    mode,
    admissibleForInclusion: admissible,
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

function buildAgingBuckets(
  part: ReturnType<typeof partitionByEligibility>,
  mode: TurnWorkOrderReportingModeValue,
): AnalysisOutput {
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
    mode,
    admissibleForInclusion: withAge,
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

function buildPropertyPressure(
  part: ReturnType<typeof partitionByEligibility>,
  mode: TurnWorkOrderReportingModeValue,
): AnalysisOutput {
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
    mode,
    admissibleForInclusion: part.admissible,
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

function buildUnitRepeatDemand(
  part: ReturnType<typeof partitionByEligibility>,
  mode: TurnWorkOrderReportingModeValue,
): AnalysisOutput {
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
  const supportingIds = repeated.flatMap(([, rows]) => rows.map((r) => r.id));

  return finalise({
    part,
    mode,
    admissibleForInclusion: repeated.flatMap(([, rows]) => rows),
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
    supportingRecordIds: supportingIds,
    recommendedReviewQuestion:
      "Do repeat demands point to a specific asset, contractor, or PM gap that should be reviewed?",
  });
}

// ─── Mode-specific extras ────────────────────────────────────────────────────

function buildTurnRelatedWorkOrders(
  part: ReturnType<typeof partitionByEligibility>,
  turnRelated: NormalizedReportingRecord[],
  possibleCount: number,
  mode: TurnWorkOrderReportingModeValue,
): AnalysisOutput {
  // Categorise turn-related WOs by their mapped stage so the operator
  // sees which turn step is consuming WO time the most.
  const byStage = new Map<string, NormalizedReportingRecord[]>();
  for (const r of turnRelated) {
    const stage =
      (r.supportingContext?.stage as string | undefined)?.trim() ||
      "Unmapped stage";
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage)!.push(r);
  }
  const ordered = [...byStage.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 8);
  const factors: ContributingFactor[] = ordered.map(([label, rows]) => ({
    label,
    displayValue: `${rows.length} turn-related work orders`,
    numericValue: rows.length,
    count: rows.length,
    supportingRecordIds: rows.map((r) => r.id),
  }));

  return finalise({
    part,
    mode,
    admissibleForInclusion: turnRelated,
    analysisId: makeAnalysisId("work_order_time_allocation", "turn-related"),
    title: "Turn-related work orders",
    summary: `${turnRelated.length} of ${part.admissible.length} admissible work orders appear to represent turn progress under the current reporting mode.`,
    metricValue: turnRelated.length,
    metricUnit: "turn-related work orders",
    contributingFactors: factors,
    minFloor: MIN_FOR_CONFIRMED,
    supportingRecordIds: turnRelated.map((r) => r.id),
    recommendedReviewQuestion:
      "Which turn-related work orders are stalling release, and do any need to be regrouped under a single unit turn?",
    turnRelatedBreakdown: {
      nativeTurnCount: 0,
      turnRelatedWorkOrderCount: turnRelated.length,
      needsConfirmationCount: possibleCount,
      excludedByModeCount: 0,
    },
  });
}

function buildPotentialTurnRelatedWorkOrders(
  part: ReturnType<typeof partitionByEligibility>,
  possible: NormalizedReportingRecord[],
  mode: TurnWorkOrderReportingModeValue,
): AnalysisOutput {
  const factors: ContributingFactor[] = possible.slice(0, 8).map((r) => {
    const op = detectTurnRelation(r);
    return {
      label: `${r.category ?? "Uncategorised"} — ${r.propertyName ?? "Unattributed"}`,
      displayValue: op.turnRelationReason,
      numericValue: 1,
      count: 1,
      supportingRecordIds: [r.id],
    };
  });

  return finalise({
    part,
    mode,
    admissibleForInclusion: possible,
    analysisId: makeAnalysisId("work_order_time_allocation", "potential-turn-related"),
    title: "Potential turn-related work orders",
    summary: `${possible.length} work order(s) show soft turn signals (stage, category, or description) but no confirmed link. Confirm the reporting mode to interpret them correctly.`,
    metricValue: possible.length,
    metricUnit: "records to confirm",
    contributingFactors: factors,
    minFloor: 1, // surfacing is the point; floor is informational only
    supportingRecordIds: possible.map((r) => r.id),
    recommendedReviewQuestion:
      "Are these work orders actually unit turns? If yes, switch to 'Work orders measure turn progress'. If no, keep 'Separate'.",
    turnRelatedBreakdown: {
      nativeTurnCount: 0,
      turnRelatedWorkOrderCount: 0,
      needsConfirmationCount: possible.length,
      excludedByModeCount: 0,
    },
    // HYBRID safety: ambiguous turn signals must never be presented as
    // confirmed_analysis — confidence is capped at qualified_analysis so
    // the UI keeps the "needs confirmation" framing.
    confidenceCap: "qualified_analysis",
  });
}

function isTurnyCategory(label: string): boolean {
  const lc = label.toLowerCase();
  return (
    lc === "turn" ||
    lc === "make ready" ||
    lc === "make-ready" ||
    lc === "turnover" ||
    lc === "vacant prep"
  );
}

// ─── shared finaliser ────────────────────────────────────────────────────────

function finalise(input: {
  part: ReturnType<typeof partitionByEligibility>;
  mode: TurnWorkOrderReportingModeValue;
  admissibleForInclusion: NormalizedReportingRecord[];
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
  turnRelatedBreakdown?: TurnRelatedBreakdown | null;
  confidenceCap?: "qualified_analysis" | "insufficient_data";
}): AnalysisOutput {
  const { part } = input;
  const now = new Date().toISOString();
  const rawConfidence = deriveConfidenceState({
    fullyReportable: part.fully.length,
    partiallyReportable: part.partial.length,
    minimumFullyForConfirmed: input.minFloor,
  });
  const confidenceState = applyConfidenceCap(rawConfidence, input.confidenceCap);
  const recordInclusionMetadata = buildInclusionMetadata(
    input.admissibleForInclusion,
    input.mode,
  );
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
    reportingModeUsed: input.mode,
    turnRelatedBreakdown: input.turnRelatedBreakdown ?? null,
    recordInclusionMetadata,
    createdAt: now,
    updatedAt: now,
  };
}

function applyConfidenceCap(
  raw: "confirmed_analysis" | "qualified_analysis" | "insufficient_data",
  cap?: "qualified_analysis" | "insufficient_data",
): "confirmed_analysis" | "qualified_analysis" | "insufficient_data" {
  if (!cap) return raw;
  if (cap === "insufficient_data") return "insufficient_data";
  // cap === "qualified_analysis": never let confirmed bubble up
  return raw === "confirmed_analysis" ? "qualified_analysis" : raw;
}

function buildInclusionMetadata(
  records: NormalizedReportingRecord[],
  mode: TurnWorkOrderReportingModeValue,
): Record<string, RecordInclusionEntry> {
  const out: Record<string, RecordInclusionEntry> = {};
  for (const r of records) {
    const op = detectTurnRelation(r);
    out[r.id] = {
      recordType: "work_order",
      turnRelationConfidence: op.turnRelationConfidence,
      inclusionReason: explainInclusion(r, op, mode),
    };
  }
  return out;
}

function explainInclusion(
  r: NormalizedReportingRecord,
  op: ReturnType<typeof detectTurnRelation>,
  mode: TurnWorkOrderReportingModeValue,
): string {
  const cat = r.category ?? "uncategorised";
  const status = r.status ?? "unknown status";
  switch (mode) {
    case "separate_turns_and_work_orders":
      return `Work order — category=${cat}, status=${status}. Mode keeps turns and work orders separate, so this row is analysed as a work order regardless of any turn signals.`;
    case "work_orders_measure_turn_progress":
      return op.isTurnRelatedCandidate
        ? `Turn-related work order — ${op.turnRelationReason} Mode treats this row as turn progress evidence.`
        : `Work order — category=${cat}. Mode would route turn-related rows to turn analyses, but this row shows no turn signals.`;
    case "hybrid_or_unknown":
      return op.needsConfirmation
        ? `Possible turn-related work order — ${op.turnRelationReason} Needs confirmation before it can feed turn analyses.`
        : op.isTurnRelatedCandidate
        ? `Likely turn-related work order — ${op.turnRelationReason} Kept under work orders until the reporting mode is confirmed.`
        : `Work order — category=${cat}, status=${status}.`;
  }
}
