/**
 * Ascent 7.2 — Reporting Analysis Output Contract
 *
 * A single shape every analysis engine produces. Surfaces (Reports page,
 * Control Tower tiles, drill-down panels) read this contract — never the
 * raw database rows. This keeps analysis logic out of the UI.
 *
 * Build 7.2 sits on top of Build 7.1 NormalizedReportingRecord. The
 * confidence state is derived strictly from the eligibility mix of the
 * records that fed the analysis:
 *
 *   - Confirmed Analysis     → only fully reportable records were used.
 *   - Qualified Analysis     → at least one partially reportable record was
 *                              used; partials are clearly labelled.
 *   - Insufficient Data      → not enough reportable records to draw a
 *                              conclusion (no fully reportable records OR
 *                              total below the engine-specific floor).
 *
 * The contract does NOT carry narrative. Build 7.3 will layer narrative
 * insights on top of this analytical engine.
 */

export type AnalysisConfidenceState =
  | "confirmed_analysis"
  | "qualified_analysis"
  | "insufficient_data";

/** Authoritative list of analysis categories produced by Build 7.2. */
export type AnalysisType =
  | "work_order_time_allocation"
  | "turn_time_allocation"
  | "pm_time_allocation"
  | "asset_warranty_risk"
  | "evidence_impact"
  | "assignment_coverage"
  | "cross_category_pressure";

/** Source category — the Build 7.1 normalised source(s) feeding this analysis. */
export type AnalysisSourceCategory =
  | "work_orders"
  | "turns"
  | "preventative_maintenance"
  | "assets"
  | "warranties"
  | "documents"
  | "assignments"
  | "multi";

/** Surfaces that may consume this analysis without duplicating its logic. */
export type CompatibleSurface =
  | "reports_page"
  | "control_tower"
  | "priority_actions_panel"
  | "work_order_performance_tile"
  | "turn_performance_tile"
  | "pm_performance_tile"
  | "asset_performance_tile"
  | "operational_health_tile"
  | "future_snapshot_layer";

/** Trend direction relative to a comparison value (informational; null when no comparison). */
export type TrendDirection = "improving" | "worsening" | "flat" | null;

/**
 * Ascent 7.2.1 — Turn / Work Order Reporting Mode (mirrors the value stored
 * in `reporting_config.turn_work_order_reporting_mode`). Surfaced on every
 * analysis output so the UI can render mode-aware labels and the audit
 * trail can be reconstructed from a single analysis payload alone.
 */
export type TurnWorkOrderReportingModeValue =
  | "separate_turns_and_work_orders"
  | "work_orders_measure_turn_progress"
  | "hybrid_or_unknown";

/**
 * Per-analysis breakdown of which kinds of records contributed when the
 * Build 7.2.1 mode logic is in play. Only populated by engines that mix
 * native turn records with turn-related work orders. Null on analyses
 * where the distinction does not apply (e.g. assets, evidence).
 */
export interface TurnRelatedBreakdown {
  /** How many native records (turns table) contributed. */
  nativeTurnCount: number;
  /** Turn-related work orders (confirmed + likely) included. */
  turnRelatedWorkOrderCount: number;
  /** Possible turn-related work orders awaiting confirmation. */
  needsConfirmationCount: number;
  /** Work orders explicitly excluded from the analysis under this mode. */
  excludedByModeCount: number;
}

/**
 * Inclusion metadata for a supporting record. Keyed by NormalizedReportingRecord.id
 * on the analysis. Surfaced in /supporting-records so each row carries an
 * explicit "why am I here" string that matches the active reporting mode.
 */
export interface RecordInclusionEntry {
  recordType: "turn" | "work_order" | "asset" | "document" | "assignment" | "other";
  inclusionReason: string;
  turnRelationConfidence?:
    | "confirmed_turn_related"
    | "likely_turn_related"
    | "possible_turn_related"
    | "not_turn_related";
}

/**
 * Reportability basis — short audit string explaining which Build 7.1
 * eligibility buckets the analysis drew from. Surfaced verbatim on
 * drill-downs so the user can see how confidence was earned.
 */
export interface ReportabilityBasis {
  /** Which eligibility tiers were admitted. */
  admitted: ("fully_reportable" | "partially_reportable")[];
  /** Plain-English explanation suitable for a tooltip. */
  explanation: string;
}

/**
 * A single contributing factor — used for category share, top-N lists,
 * bottleneck stages, top property pressure, etc. Always carries a label
 * and a value; carries optional `count` for distinct-record breakdowns and
 * optional `supportingRecordIds` so each row can drill down on its own.
 */
export interface ContributingFactor {
  label: string;
  /** Display value (e.g. "42 work orders", "18.3 days", "63%"). */
  displayValue: string;
  /** Raw numeric value (for sorting / future computation). */
  numericValue: number;
  /** Underlying record count if the factor groups records. */
  count?: number;
  /** Subset of supportingRecordIds that produced THIS factor. */
  supportingRecordIds?: string[];
}

/**
 * Every analysis engine returns an array of AnalysisOutput. One engine can
 * emit multiple outputs (e.g. work-order analysis emits top-categories,
 * aging-buckets, and unit-repeat-demand each as its own output) so each can
 * be wired independently into the appropriate Control Tower tile.
 */
export interface AnalysisOutput {
  // Identity
  analysisId: string;
  analysisType: AnalysisType;
  sourceCategory: AnalysisSourceCategory;

  // Optional scoping (multi-tenant aware; populated by orchestrator when known)
  organizationId: number | null;
  propertyId: number | null;
  unitId: number | null;

  // Window
  dateRange: { startIso: string | null; endIso: string | null };

  // Narrative-light copy (Build 7.3 will replace with richer narrative)
  title: string;
  summary: string;

  // Metric headline (optional — some analyses are list-only)
  metricValue: number | null;
  metricUnit: string | null;
  comparisonValue: number | null;
  trendDirection: TrendDirection;

  // Time-allocation fields (optional — only meaningful for time analyses)
  timeAllocationShare: number | null;
  estimatedTimeImpactHours: number | null;

  // Bottleneck context (optional)
  bottleneckStage: string | null;
  primaryCategory: string | null;

  // The ordered list of contributors that shape the result. Top-N is at
  // the engine's discretion (typically capped at 5-10).
  contributingFactors: ContributingFactor[];

  // Honesty layer — every analysis MUST surface these
  confidenceState: AnalysisConfidenceState;
  reportabilityBasis: ReportabilityBasis;
  fullyReportableRecordCount: number;
  partiallyReportableRecordCount: number;
  excludedRecordCount: number;
  missingFields: string[];

  // Supporting records — the proof set behind the analysis.
  // IDs are NormalizedReportingRecord.id values ("work_orders:42") so the
  // /supporting-records endpoint can hydrate them from Build 7.1.
  supportingRecordIds: string[];
  supportingRecordCount: number;

  // Recommended review question — a brief prompt aimed at the operator.
  recommendedReviewQuestion: string;

  // Surfaces that should consume this analysis (informational)
  compatibleSurfaces: CompatibleSurface[];

  // Ascent 7.2.1 — Mode awareness. Every analysis records the mode that was
  // active when it was computed so the UI can explain "why does WO category
  // 'Turn' show under turns now?" without re-querying the config service.
  reportingModeUsed: TurnWorkOrderReportingModeValue;
  /** Null on analyses where the WO ↔ turn distinction does not apply. */
  turnRelatedBreakdown: TurnRelatedBreakdown | null;
  /**
   * Per-record inclusion explanations. Map keys are
   * NormalizedReportingRecord.id strings (e.g. "work_orders:42"). May be
   * empty on legacy analyses; consumers should treat absence as "default
   * inclusion (admissible per Build 7.1 gate)".
   */
  recordInclusionMetadata: Record<string, RecordInclusionEntry>;

  // Timestamps
  createdAt: string;
  updatedAt: string;
}

// ─── Helpers used by every engine ────────────────────────────────────────────

/**
 * Derive the confidence state from the eligibility mix.
 *
 * Hard rules (per Build 7.2 spec):
 *
 *   - Confirmed Analysis may ONLY come from fully reportable records.
 *     If a single partial slips in, confidence drops to Qualified.
 *
 *   - When NO fully reportable records are admissible, the analysis must
 *     be Insufficient Data. Even if partials meet the threshold, we will
 *     not promote a conclusion drawn entirely from partial records to
 *     "Qualified" — Qualified implies at least SOME of the conclusion
 *     was confirmed. (This was tightened during architect review round 1
 *     of Build 7.2; previously this branch returned qualified, which let
 *     fully-partial analyses masquerade as a half-confirmed signal.)
 *
 *   - Insufficient Data is also returned when the admissible total is
 *     below the engine-specific floor.
 *
 * The minimumFullyForConfirmed floor is the smallest fully-reportable count
 * an engine considers "enough to draw a conclusion".
 */
export function deriveConfidenceState(input: {
  fullyReportable: number;
  partiallyReportable: number;
  minimumFullyForConfirmed: number;
}): AnalysisConfidenceState {
  const { fullyReportable, partiallyReportable, minimumFullyForConfirmed } = input;
  // No fully reportable records → never confirmed, never qualified.
  // The user has nothing to point to that the ingestion gate accepted with
  // full confidence, so the analysis is honestly Insufficient Data until
  // upstream data quality improves.
  if (fullyReportable === 0) {
    return "insufficient_data";
  }
  if (fullyReportable >= minimumFullyForConfirmed && partiallyReportable === 0) {
    return "confirmed_analysis";
  }
  if (fullyReportable + partiallyReportable >= minimumFullyForConfirmed) {
    return "qualified_analysis";
  }
  return "insufficient_data";
}

/**
 * Combine multiple confidence states into the WEAKEST of the inputs.
 * Used by the cross-category pressure analyser to honestly inherit the
 * weakest input — any Insufficient input poisons the whole.
 */
export function weakestConfidenceState(
  states: AnalysisConfidenceState[],
): AnalysisConfidenceState {
  if (states.some((s) => s === "insufficient_data")) return "insufficient_data";
  if (states.some((s) => s === "qualified_analysis")) return "qualified_analysis";
  return "confirmed_analysis";
}

export function buildReportabilityBasis(input: {
  fullyReportable: number;
  partiallyReportable: number;
  excluded: number;
}): ReportabilityBasis {
  const admitted: ("fully_reportable" | "partially_reportable")[] = [];
  if (input.fullyReportable > 0) admitted.push("fully_reportable");
  if (input.partiallyReportable > 0) admitted.push("partially_reportable");

  const explanation =
    admitted.length === 0
      ? `No reportable records admitted. ${input.excluded} record(s) excluded by the Build 7.1 ingestion gate.`
      : admitted.length === 2
      ? `Analysis used ${input.fullyReportable} fully reportable and ${input.partiallyReportable} partially reportable record(s); ` +
        `${input.excluded} record(s) excluded.`
      : admitted[0] === "fully_reportable"
      ? `Analysis used ${input.fullyReportable} fully reportable record(s); ${input.excluded} excluded.`
      : `Analysis used ${input.partiallyReportable} partially reportable record(s); no fully reportable records available.`;

  return { admitted, explanation };
}

/** Generate a stable-ish analysis id from type + key context. */
export function makeAnalysisId(type: AnalysisType, suffix: string): string {
  return `${type}:${suffix}`;
}

/** Standard helpers for blank analyses (used when an engine has no admissible data). */
export function emptyAnalysis(input: {
  analysisType: AnalysisType;
  sourceCategory: AnalysisSourceCategory;
  title: string;
  summary: string;
  excludedRecordCount: number;
  compatibleSurfaces: CompatibleSurface[];
  recommendedReviewQuestion: string;
  reportingModeUsed?: TurnWorkOrderReportingModeValue;
}): AnalysisOutput {
  const now = new Date().toISOString();
  return {
    analysisId: makeAnalysisId(input.analysisType, "insufficient"),
    analysisType: input.analysisType,
    sourceCategory: input.sourceCategory,
    organizationId: null,
    propertyId: null,
    unitId: null,
    dateRange: { startIso: null, endIso: null },
    title: input.title,
    summary: input.summary,
    metricValue: null,
    metricUnit: null,
    comparisonValue: null,
    trendDirection: null,
    timeAllocationShare: null,
    estimatedTimeImpactHours: null,
    bottleneckStage: null,
    primaryCategory: null,
    contributingFactors: [],
    confidenceState: "insufficient_data",
    reportabilityBasis: buildReportabilityBasis({
      fullyReportable: 0,
      partiallyReportable: 0,
      excluded: input.excludedRecordCount,
    }),
    fullyReportableRecordCount: 0,
    partiallyReportableRecordCount: 0,
    excludedRecordCount: input.excludedRecordCount,
    missingFields: [],
    supportingRecordIds: [],
    supportingRecordCount: 0,
    recommendedReviewQuestion: input.recommendedReviewQuestion,
    compatibleSurfaces: input.compatibleSurfaces,
    reportingModeUsed: input.reportingModeUsed ?? "hybrid_or_unknown",
    turnRelatedBreakdown: null,
    recordInclusionMetadata: {},
    createdAt: now,
    updatedAt: now,
  };
}
