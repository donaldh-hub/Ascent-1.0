/**
 * Ascent 7.2 → 7.2.1 — Turn / Make-Ready Analysis Engine
 *
 * Uses turn language only — turn, make-ready, vacant days, stage,
 * bottleneck stage, rent-ready. Never describes a work order as a turn
 * UNLESS the active Turn / Work Order Reporting Mode explicitly says
 * work orders are the way this organization measures turn progress.
 *
 * Always emits the base three analyses:
 *
 *   1. Bottleneck stage (which stage is slowing release)
 *   2. Vacant-days distribution (how long turns are sitting)
 *   3. Property turn-pressure (where the load is)
 *
 * Mode-aware extras (Build 7.2.1):
 *
 *   - work_orders_measure_turn_progress: adds "Turn Completion Evidence
 *     (from work orders)" and "Turn Delay Evidence (from work orders)"
 *     drawn from confirmed + likely turn-related WOs.
 *   - hybrid_or_unknown: when at least one confirmed/likely turn-related
 *     WO exists, surfaces a "Turn-related work orders observed" insight
 *     that is qualified by mode uncertainty.
 *   - separate_turns_and_work_orders: native turn analyses only.
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

const SURFACES = ["reports_page", "control_tower", "turn_performance_tile"] as const;
const MIN_FOR_CONFIRMED = 5; // turn-data tables are typically smaller than WO

export interface TurnAnalysisOptions {
  mode: TurnWorkOrderReportingModeValue;
  /** Admissible work-order records (pre-partitioned by the orchestrator). */
  workOrderRecords?: NormalizedReportingRecord[];
}

export function analyseTurns(
  records: NormalizedReportingRecord[],
  opts: TurnAnalysisOptions = { mode: "hybrid_or_unknown" },
): AnalysisOutput[] {
  const mode = opts.mode;
  const part = partitionByEligibility(records);
  const woRecords = opts.workOrderRecords ?? [];
  const woAdmissible = partitionByEligibility(woRecords).admissible;
  const woBreakdown = partitionWorkOrdersByTurnRelation(woAdmissible);

  if (part.admissible.length === 0 && mode !== "work_orders_measure_turn_progress") {
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
        reportingModeUsed: mode,
      }),
    ];
  }

  const out: AnalysisOutput[] = [];
  if (part.admissible.length > 0) {
    out.push(
      buildBottleneckStage(part, mode, woBreakdown),
      buildVacantDays(part, mode, woBreakdown),
      buildPropertyTurnPressure(part, mode, woBreakdown),
    );
  }

  if (mode === "work_orders_measure_turn_progress") {
    const turnRelated = [...woBreakdown.confirmed, ...woBreakdown.likely];
    if (turnRelated.length > 0) {
      out.push(buildTurnCompletionEvidence(part, turnRelated, mode, woBreakdown));
      out.push(buildTurnDelayEvidence(part, turnRelated, mode, woBreakdown));
    } else if (part.admissible.length === 0) {
      // Honest empty state when no native turns AND no turn-related WOs.
      out.push(
        emptyAnalysis({
          analysisType: "turn_time_allocation",
          sourceCategory: "turns",
          title: "Turn progress (work-order evidence)",
          summary:
            "Mode says work orders measure turn progress, but no work orders show turn signals yet.",
          excludedRecordCount: woAdmissible.length,
          compatibleSurfaces: [...SURFACES],
          recommendedReviewQuestion:
            "Add a turn category (Turn / Make Ready) or stage to the relevant work orders so they can act as turn evidence.",
          reportingModeUsed: mode,
        }),
      );
    }
  } else if (mode === "hybrid_or_unknown") {
    const turnRelated = [...woBreakdown.confirmed, ...woBreakdown.likely];
    if (turnRelated.length > 0 || woBreakdown.possible.length > 0) {
      out.push(buildHybridTurnRelatedInsight(part, woBreakdown, mode));
    }
  }

  return out;
}

// ─── Native turn analyses ────────────────────────────────────────────────────

function buildBottleneckStage(
  part: ReturnType<typeof partitionByEligibility>,
  mode: TurnWorkOrderReportingModeValue,
  woBreakdown: ReturnType<typeof partitionWorkOrdersByTurnRelation>,
): AnalysisOutput {
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
    mode,
    admissibleForInclusion: part.admissible,
    workOrderRecords: [],
    woBreakdown,
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

function buildVacantDays(
  part: ReturnType<typeof partitionByEligibility>,
  mode: TurnWorkOrderReportingModeValue,
  woBreakdown: ReturnType<typeof partitionWorkOrdersByTurnRelation>,
): AnalysisOutput {
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
    mode,
    admissibleForInclusion: withDays,
    workOrderRecords: [],
    woBreakdown,
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

function buildPropertyTurnPressure(
  part: ReturnType<typeof partitionByEligibility>,
  mode: TurnWorkOrderReportingModeValue,
  woBreakdown: ReturnType<typeof partitionWorkOrdersByTurnRelation>,
): AnalysisOutput {
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
    mode,
    admissibleForInclusion: part.admissible,
    workOrderRecords: [],
    woBreakdown,
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

// ─── Mode-specific WO-evidence analyses (MEASURE mode) ───────────────────────

function buildTurnCompletionEvidence(
  part: ReturnType<typeof partitionByEligibility>,
  turnRelated: NormalizedReportingRecord[],
  mode: TurnWorkOrderReportingModeValue,
  woBreakdown: ReturnType<typeof partitionWorkOrdersByTurnRelation>,
): AnalysisOutput {
  const completed = turnRelated.filter(
    (r) => (r.status ?? "").toLowerCase() === "completed",
  );
  const open = turnRelated.length - completed.length;

  const factors: ContributingFactor[] = [
    {
      label: "Completed turn-related work orders",
      displayValue: `${completed.length} completed`,
      numericValue: completed.length,
      count: completed.length,
      supportingRecordIds: completed.map((r) => r.id),
    },
    {
      label: "Open turn-related work orders",
      displayValue: `${open} still open`,
      numericValue: open,
      count: open,
      supportingRecordIds: turnRelated
        .filter((r) => (r.status ?? "").toLowerCase() !== "completed")
        .map((r) => r.id),
    },
  ];

  return finalise({
    part,
    mode,
    admissibleForInclusion: turnRelated,
    workOrderRecords: turnRelated,
    woBreakdown,
    analysisId: makeAnalysisId("turn_time_allocation", "turn-completion-evidence"),
    title: "Turn completion evidence (from work orders)",
    summary: `${completed.length} of ${turnRelated.length} turn-related work orders are completed under the current reporting mode.`,
    metricValue: completed.length,
    metricUnit: "completed turn work orders",
    contributingFactors: factors,
    supportingRecordIds: turnRelated.map((r) => r.id),
    recommendedReviewQuestion:
      "Do the completed turn-related work orders correspond to units that have actually been released to leasing?",
  });
}

function buildTurnDelayEvidence(
  part: ReturnType<typeof partitionByEligibility>,
  turnRelated: NormalizedReportingRecord[],
  mode: TurnWorkOrderReportingModeValue,
  woBreakdown: ReturnType<typeof partitionWorkOrdersByTurnRelation>,
): AnalysisOutput {
  const delayed = turnRelated.filter(
    (r) => (r.ageDays ?? 0) > 30 || (r.supportingContext?.isBlocked === true),
  );
  const factors: ContributingFactor[] = delayed.slice(0, 8).map((r) => ({
    label: `${r.propertyName ?? "Unattributed"} • ${r.unitNameOrNumber ?? "?"}`,
    displayValue: `${r.ageDays ?? 0}d open — ${r.category ?? "uncategorised"}`,
    numericValue: r.ageDays ?? 0,
    count: 1,
    supportingRecordIds: [r.id],
  }));

  return finalise({
    part,
    mode,
    admissibleForInclusion: delayed,
    workOrderRecords: turnRelated,
    woBreakdown,
    analysisId: makeAnalysisId("turn_time_allocation", "turn-delay-evidence"),
    title: "Turn delay evidence (from work orders)",
    summary: `${delayed.length} turn-related work orders are aged >30 days or blocked — likely turn delays under the current reporting mode.`,
    metricValue: delayed.length,
    metricUnit: "delayed turn work orders",
    contributingFactors: factors,
    supportingRecordIds: delayed.map((r) => r.id),
    recommendedReviewQuestion:
      "Which delayed turn-related work orders are blocking unit release the longest?",
  });
}

function buildHybridTurnRelatedInsight(
  part: ReturnType<typeof partitionByEligibility>,
  woBreakdown: ReturnType<typeof partitionWorkOrdersByTurnRelation>,
  mode: TurnWorkOrderReportingModeValue,
): AnalysisOutput {
  const turnRelated = [...woBreakdown.confirmed, ...woBreakdown.likely];
  const possible = woBreakdown.possible;
  const all = [...turnRelated, ...possible];
  const factors: ContributingFactor[] = [
    {
      label: "Confirmed / likely turn-related work orders",
      displayValue: `${turnRelated.length} record(s)`,
      numericValue: turnRelated.length,
      count: turnRelated.length,
      supportingRecordIds: turnRelated.map((r) => r.id),
    },
    {
      label: "Possible — needs confirmation",
      displayValue: `${possible.length} record(s)`,
      numericValue: possible.length,
      count: possible.length,
      supportingRecordIds: possible.map((r) => r.id),
    },
  ];
  return finalise({
    part,
    mode,
    admissibleForInclusion: all,
    workOrderRecords: all,
    woBreakdown,
    analysisId: makeAnalysisId("turn_time_allocation", "hybrid-turn-related-wo"),
    title: "Turn-related work orders observed",
    summary:
      `${turnRelated.length} work order(s) look turn-related and ${possible.length} more need confirmation. ` +
      `Mode is hybrid_or_unknown, so they stay in the work-order section until you confirm how this org tracks turns.`,
    metricValue: turnRelated.length + possible.length,
    metricUnit: "potential turn signals",
    contributingFactors: factors,
    supportingRecordIds: all.map((r) => r.id),
    recommendedReviewQuestion:
      "Should these work orders count as turn progress for this organization? Confirm the reporting mode to lock it in.",
    // HYBRID safety: this insight is built on WO rows whose turn
    // relationship has not been confirmed. Never present it as a
    // confirmed analysis regardless of WO data quality.
    confidenceCap: "qualified_analysis",
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

// ─── shared finaliser ────────────────────────────────────────────────────────

function finalise(input: {
  part: ReturnType<typeof partitionByEligibility>;
  mode: TurnWorkOrderReportingModeValue;
  admissibleForInclusion: NormalizedReportingRecord[];
  workOrderRecords: NormalizedReportingRecord[];
  woBreakdown: ReturnType<typeof partitionWorkOrdersByTurnRelation>;
  analysisId: string;
  title: string;
  summary: string;
  metricValue: number | null;
  metricUnit: string | null;
  bottleneckStage?: string | null;
  contributingFactors: ContributingFactor[];
  supportingRecordIds: string[];
  recommendedReviewQuestion: string;
  confidenceCap?: "qualified_analysis" | "insufficient_data";
}): AnalysisOutput {
  const now = new Date().toISOString();
  const nativeTurns = input.admissibleForInclusion.filter(
    (r) => r.sourceType === "turns",
  );
  const woRecords = input.admissibleForInclusion.filter(
    (r) => r.sourceType === "work_orders",
  );
  // Eligibility figures are derived from native turn records when present;
  // when the analysis is purely WO-evidence (MEASURE mode extras) we
  // derive them from the included WO records so confidence still reflects
  // ingestion quality rather than turn-table size.
  const eligibilitySource = nativeTurns.length > 0 ? nativeTurns : woRecords;
  const eligPart = partitionByEligibility(eligibilitySource);
  const rawConfidence = deriveConfidenceState({
    fullyReportable: eligPart.fully.length,
    partiallyReportable: eligPart.partial.length,
    minimumFullyForConfirmed: MIN_FOR_CONFIRMED,
  });
  // HYBRID safety + WO-derived turn evidence: never let ambiguous turn
  // signals or unconfirmed-mode WO inferences appear as confirmed.
  const cap = input.confidenceCap;
  const confidenceState =
    cap === "insufficient_data"
      ? "insufficient_data"
      : cap === "qualified_analysis" && rawConfidence === "confirmed_analysis"
      ? "qualified_analysis"
      : rawConfidence;
  const turnRelatedWoIncluded = woRecords.length;
  const turnRelatedBreakdown: TurnRelatedBreakdown | null =
    nativeTurns.length === 0 && turnRelatedWoIncluded === 0
      ? null
      : {
          nativeTurnCount: nativeTurns.length,
          turnRelatedWorkOrderCount: turnRelatedWoIncluded,
          needsConfirmationCount: input.woBreakdown.possible.length,
          excludedByModeCount:
            input.mode === "separate_turns_and_work_orders"
              ? input.woBreakdown.confirmed.length +
                input.woBreakdown.likely.length
              : 0,
        };

  const recordInclusionMetadata = buildInclusionMetadata(
    input.admissibleForInclusion,
    input.mode,
  );

  return {
    analysisId: input.analysisId,
    analysisType: "turn_time_allocation",
    sourceCategory: "turns",
    organizationId: null,
    propertyId: null,
    unitId: null,
    dateRange: computeDateRange(input.admissibleForInclusion),
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
      fullyReportable: eligPart.fully.length,
      partiallyReportable: eligPart.partial.length,
      excluded: input.part.excluded.length,
    }),
    fullyReportableRecordCount: eligPart.fully.length,
    partiallyReportableRecordCount: eligPart.partial.length,
    excludedRecordCount: input.part.excluded.length,
    missingFields: summarizeMissingFields(input.admissibleForInclusion),
    supportingRecordIds: input.supportingRecordIds,
    supportingRecordCount: input.supportingRecordIds.length,
    recommendedReviewQuestion: input.recommendedReviewQuestion,
    compatibleSurfaces: [...SURFACES],
    reportingModeUsed: input.mode,
    turnRelatedBreakdown,
    recordInclusionMetadata,
    createdAt: now,
    updatedAt: now,
  };
}

function buildInclusionMetadata(
  records: NormalizedReportingRecord[],
  mode: TurnWorkOrderReportingModeValue,
): Record<string, RecordInclusionEntry> {
  const out: Record<string, RecordInclusionEntry> = {};
  for (const r of records) {
    if (r.sourceType === "turns") {
      out[r.id] = {
        recordType: "turn",
        inclusionReason: `Native turn record — stage=${
          (r.supportingContext?.currentStage as string | undefined) ?? "unknown"
        }, status=${r.status ?? "unknown"}.`,
      };
    } else if (r.sourceType === "work_orders") {
      const op = detectTurnRelation(r);
      out[r.id] = {
        recordType: "work_order",
        turnRelationConfidence: op.turnRelationConfidence,
        inclusionReason:
          mode === "work_orders_measure_turn_progress"
            ? `Turn-related work order — ${op.turnRelationReason} Mode treats it as turn evidence.`
            : `Turn-related work order — ${op.turnRelationReason} Surfaced under turns for review only; mode has not confirmed merging.`,
      };
    }
  }
  return out;
}
