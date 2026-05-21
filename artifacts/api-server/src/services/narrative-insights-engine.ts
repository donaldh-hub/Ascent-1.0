/**
 * Ascent 7.3 — Narrative Insights Engine
 *
 * Converts Build 7.2 AnalysisOutputs into structured, evidence-backed
 * narrative insights. Computes everything from the existing reporting
 * spine — no new tables, no separate narrative database, no fake data.
 *
 * Hard rules (per Build 7.3 spec):
 *
 *   - Never invent counts, narratives, or conclusions. Every insight is
 *     derived directly from an AnalysisOutput and carries the
 *     analysisId so its supporting records can be drilled to via the
 *     existing /api/reporting-analysis/supporting-records endpoint.
 *   - Insights respect the Build 7.2.1 reporting mode. Turn-related
 *     work-order language only appears in MEASURE mode; HYBRID renders
 *     "needs confirmation" framing instead. WO closure is never spoken
 *     of as turn completion in SEPARATE or HYBRID modes.
 *   - dataSupportLevel = "not_enough_data" emits a reporting-readiness
 *     message instead of an operational insight.
 *   - Severity / confidence / data-support are mapped from the analysis
 *     confidence state + reportability mix — not invented in the UI.
 */

import type {
  AnalysisOutput,
  AnalysisConfidenceState,
  AnalysisType,
  TurnWorkOrderReportingModeValue,
} from "./analysis-output-contract.js";
import type {
  ReportingAnalysisBundle,
  ReportingModeSummary,
} from "./reporting-analysis-service.js";
import { flattenBundle } from "./reporting-analysis-service.js";

const BUILD_VERSION = "7.3.0";

// ─── Public contract ──────────────────────────────────────────────────────────

export type InsightCategory =
  | "work_order_performance"
  | "turn_performance"
  | "preventative_maintenance_readiness"
  | "asset_warranty_readiness"
  | "assignment_coverage"
  | "evidence_documentation_gaps"
  | "time_allocation"
  | "bottleneck_detection"
  | "risk_pattern"
  | "data_quality_reporting_readiness";

export type InsightSeverity =
  | "informational"
  | "watch"
  | "needs_review"
  | "priority"
  | "critical";

export type InsightConfidence = "high" | "medium" | "low";

export type InsightDataSupport =
  | "fully_supported"
  | "partially_supported"
  | "directional_only"
  | "not_enough_data";

export interface InsightReportabilityBreakdown {
  fullyReportableCount: number;
  partiallyReportableCount: number;
  notReportableYetCount: number;
  totalRecordsReviewed: number;
  percentFullyReportable: number;
  limitationText: string | null;
}

export interface NarrativeInsight {
  insightId: string;
  /** The Build 7.2 analysis this insight was derived from. Drives drill-through. */
  sourceAnalysisId: string;
  organizationId: number | null;
  propertyId: number | null;

  reportType: string;
  insightCategory: InsightCategory;
  insightSeverity: InsightSeverity;
  confidenceLevel: InsightConfidence;
  dataSupportLevel: InsightDataSupport;

  headline: string;
  plainLanguageSummary: string;
  operationalWhyItMatters: string;

  supportingRecordCount: number;
  supportingRecordIds: string[];

  sourceMetricsUsed: string[];
  reportabilityBreakdown: InsightReportabilityBreakdown;
  limitationText: string | null;

  recommendedReviewQuestion: string;
  suggestedNextStep: string;

  reportingModeUsed: TurnWorkOrderReportingModeValue;

  createdAt: string;
  generatedFromBuildVersion: string;
}

export interface NarrativeInsightsBundle {
  insights: NarrativeInsight[];
  emptyState: {
    isEmpty: boolean;
    message: string;
    recordsUploaded: number;
    fullyReportableRecords: number;
    partiallyReportableRecords: number;
    notReportableYetRecords: number;
    missingFieldsBlockingInsights: string[];
    suggestedNextUpload: string;
  };
  reportingMode: ReportingModeSummary;
  generatedAt: string;
  generatedFromBuildVersion: string;
}

// ─── Engine entrypoint ────────────────────────────────────────────────────────

export function buildNarrativeInsights(
  bundle: ReportingAnalysisBundle,
): NarrativeInsightsBundle {
  const analyses = flattenBundle(bundle);
  const mode = bundle.reportingMode.mode;

  const insights: NarrativeInsight[] = [];
  for (const a of analyses) {
    const generated = generateForAnalysis(a, mode);
    if (generated) insights.push(generated);
  }

  // Stable ordering: severity descending, then confidence descending.
  insights.sort((a, b) => {
    const s = severityRank(b.insightSeverity) - severityRank(a.insightSeverity);
    if (s !== 0) return s;
    return confidenceRank(b.confidenceLevel) - confidenceRank(a.confidenceLevel);
  });

  return {
    insights,
    emptyState: buildEmptyState(analyses, insights),
    reportingMode: bundle.reportingMode,
    generatedAt: new Date().toISOString(),
    generatedFromBuildVersion: BUILD_VERSION,
  };
}

// ─── Per-analysis insight generation ──────────────────────────────────────────

function generateForAnalysis(
  a: AnalysisOutput,
  mode: TurnWorkOrderReportingModeValue,
): NarrativeInsight | null {
  const dataSupport = mapDataSupport(a);
  const category = mapInsightCategory(a);
  const confidence = mapConfidence(a.confidenceState);
  const severity = mapSeverity(a, dataSupport);
  const reportabilityBreakdown = buildReportabilityBreakdown(a);
  const limitationText = buildLimitationText(a, reportabilityBreakdown);

  // Reporting-readiness branch: any analysis whose underlying confidence
  // is `insufficient_data` MUST emit a data-quality / readiness note
  // rather than an operational claim — even if a few supporting records
  // exist (those rows can still be drilled, but the narrative layer
  // must not present them as a confirmed trend). Per spec
  // §"Confidence and Data Support Rules".
  if (
    a.confidenceState === "insufficient_data" ||
    dataSupport === "not_enough_data"
  ) {
    if (
      a.supportingRecordCount === 0 &&
      a.fullyReportableRecordCount === 0 &&
      a.partiallyReportableRecordCount === 0
    ) {
      // Nothing at all to report — skip, the bundle-level emptyState will
      // explain it.
      return null;
    }
    return {
      insightId: `insight:${a.analysisId}:readiness`,
      sourceAnalysisId: a.analysisId,
      organizationId: a.organizationId,
      propertyId: a.propertyId,
      reportType: reportTypeFor(a),
      insightCategory: "data_quality_reporting_readiness",
      insightSeverity: "informational",
      confidenceLevel: "low",
      dataSupportLevel: "not_enough_data",
      headline: `Reporting not yet ready: ${a.title}`,
      plainLanguageSummary:
        `Ascent does not yet have enough reportable records to draw a conclusion for "${a.title}". ` +
        (a.missingFields.length > 0
          ? `Records are missing ${formatMissingFields(a.missingFields)}.`
          : `Either too few records have been uploaded or required fields are missing.`),
      operationalWhyItMatters:
        "Without enough fully reportable records, conclusions in this area would be directional at best. " +
        "Improving the underlying data will let Ascent show a real, evidence-backed insight here.",
      supportingRecordCount: a.supportingRecordCount,
      supportingRecordIds: a.supportingRecordIds,
      sourceMetricsUsed: sourceMetricsFor(a),
      reportabilityBreakdown,
      limitationText:
        limitationText ??
        "Not enough fully reportable records to support a confirmed conclusion yet.",
      recommendedReviewQuestion: readinessReviewQuestion(a),
      suggestedNextStep: readinessNextStep(a),
      reportingModeUsed: a.reportingModeUsed,
      createdAt: new Date().toISOString(),
      generatedFromBuildVersion: BUILD_VERSION,
    };
  }

  // Operational insight branch.
  return {
    insightId: `insight:${a.analysisId}`,
    sourceAnalysisId: a.analysisId,
    organizationId: a.organizationId,
    propertyId: a.propertyId,
    reportType: reportTypeFor(a),
    insightCategory: category,
    insightSeverity: severity,
    confidenceLevel: confidence,
    dataSupportLevel: dataSupport,
    headline: buildHeadline(a, mode),
    plainLanguageSummary: buildPlainLanguageSummary(a, mode),
    operationalWhyItMatters: buildWhyItMatters(a, mode),
    supportingRecordCount: a.supportingRecordCount,
    supportingRecordIds: a.supportingRecordIds,
    sourceMetricsUsed: sourceMetricsFor(a),
    reportabilityBreakdown,
    limitationText,
    recommendedReviewQuestion: a.recommendedReviewQuestion,
    suggestedNextStep: buildSuggestedNextStep(a, mode),
    reportingModeUsed: a.reportingModeUsed,
    createdAt: new Date().toISOString(),
    generatedFromBuildVersion: BUILD_VERSION,
  };
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapInsightCategory(a: AnalysisOutput): InsightCategory {
  // Bottleneck takes precedence when the analysis literally surfaces a stage.
  if (a.bottleneckStage) return "bottleneck_detection";
  switch (a.analysisType) {
    case "work_order_time_allocation":
      return a.timeAllocationShare != null ? "time_allocation" : "work_order_performance";
    case "turn_time_allocation":
      return a.timeAllocationShare != null ? "time_allocation" : "turn_performance";
    case "pm_time_allocation":
      return "preventative_maintenance_readiness";
    case "asset_warranty_risk":
      return "asset_warranty_readiness";
    case "evidence_impact":
      return "evidence_documentation_gaps";
    case "assignment_coverage":
      return "assignment_coverage";
    case "cross_category_pressure":
      return "risk_pattern";
  }
}

function mapConfidence(state: AnalysisConfidenceState): InsightConfidence {
  switch (state) {
    case "confirmed_analysis":
      return "high";
    case "qualified_analysis":
      return "medium";
    case "insufficient_data":
      return "low";
  }
}

function mapDataSupport(a: AnalysisOutput): InsightDataSupport {
  if (a.confidenceState === "confirmed_analysis") return "fully_supported";
  if (a.confidenceState === "qualified_analysis") {
    // If qualified but fully count is 0 (e.g. cap was applied), this is
    // directional only.
    return a.fullyReportableRecordCount === 0 ? "directional_only" : "partially_supported";
  }
  // insufficient_data
  if (a.supportingRecordCount === 0) return "not_enough_data";
  // Some records exist but confidence is insufficient → directional only,
  // not "not_enough_data". Only return "not_enough_data" when truly empty.
  return a.fullyReportableRecordCount === 0 && a.partiallyReportableRecordCount === 0
    ? "not_enough_data"
    : "directional_only";
}

/**
 * Map severity using existing scoring/risk inputs. The spec forbids
 * inventing a separate severity system, so this leans on what each
 * analysis already exposes: count of supporting records, time-impact
 * hours, bottleneck presence, and confidence.
 */
function mapSeverity(a: AnalysisOutput, support: InsightDataSupport): InsightSeverity {
  if (support === "not_enough_data") return "informational";
  if (support === "directional_only") return "watch";

  const isRiskFamily =
    a.analysisType === "asset_warranty_risk" ||
    a.analysisType === "cross_category_pressure";
  const isBottleneck = a.bottleneckStage != null;
  const count = a.supportingRecordCount;
  const timeImpact = a.estimatedTimeImpactHours ?? 0;

  // Critical: large supporting set or major time impact on risk/bottleneck.
  if ((isRiskFamily || isBottleneck) && (count >= 20 || timeImpact >= 80)) {
    return "critical";
  }
  // Priority: meaningful supporting volume on risk/bottleneck/time-allocation.
  if ((isRiskFamily || isBottleneck) && count >= 8) return "priority";
  if (a.analysisType === "work_order_time_allocation" && count >= 25) {
    return "priority";
  }
  if (count >= 12) return "needs_review";
  if (count >= 3) return "watch";
  return "informational";
}

function buildReportabilityBreakdown(a: AnalysisOutput): InsightReportabilityBreakdown {
  const total =
    a.fullyReportableRecordCount +
    a.partiallyReportableRecordCount +
    a.excludedRecordCount;
  const percent =
    total > 0 ? Math.round((a.fullyReportableRecordCount / total) * 100) : 0;
  return {
    fullyReportableCount: a.fullyReportableRecordCount,
    partiallyReportableCount: a.partiallyReportableRecordCount,
    notReportableYetCount: a.excludedRecordCount,
    totalRecordsReviewed: total,
    percentFullyReportable: percent,
    limitationText: null,
  };
}

function buildLimitationText(
  a: AnalysisOutput,
  rb: InsightReportabilityBreakdown,
): string | null {
  if (rb.totalRecordsReviewed === 0) return null;
  const partialShare =
    rb.partiallyReportableCount /
    Math.max(1, rb.totalRecordsReviewed);
  if (a.confidenceState === "confirmed_analysis" && partialShare === 0) {
    return null;
  }
  const pct = Math.round(partialShare * 100);
  if (a.confidenceState === "qualified_analysis") {
    return (
      `Because ${pct}% of the related records are only partially reportable, ` +
      `this insight should be treated as directional until missing fields are resolved.`
    );
  }
  if (a.confidenceState === "insufficient_data") {
    return (
      `Not enough fully reportable records to draw a confirmed conclusion. ` +
      (a.missingFields.length > 0
        ? `Records are missing ${formatMissingFields(a.missingFields)}.`
        : `Upload more complete records to strengthen this view.`)
    );
  }
  return null;
}

// ─── Language builders ────────────────────────────────────────────────────────

function buildHeadline(
  a: AnalysisOutput,
  mode: TurnWorkOrderReportingModeValue,
): string {
  // Honor mode-specific framing for turn/WO crossover.
  if (a.analysisType === "work_order_time_allocation" && /turn-related/i.test(a.title)) {
    if (mode === "hybrid_or_unknown") {
      return `Possible turn-related work orders need confirmation (${a.supportingRecordCount})`;
    }
    if (mode === "work_orders_measure_turn_progress") {
      return `Turn-related work orders are shaping turn progress (${a.supportingRecordCount})`;
    }
  }
  if (a.bottleneckStage) {
    return `${capitalize(a.bottleneckStage)} is the strongest bottleneck signal`;
  }
  if (a.primaryCategory) {
    return `${a.primaryCategory} is concentrating attention`;
  }
  return a.title;
}

function buildPlainLanguageSummary(
  a: AnalysisOutput,
  mode: TurnWorkOrderReportingModeValue,
): string {
  const base = a.summary?.trim() || a.title;
  // Mode-aware safety language for turn/WO crossover.
  if (
    a.analysisType === "turn_time_allocation" &&
    mode === "hybrid_or_unknown" &&
    /work-order|work order|turn-related/i.test(a.title + " " + base)
  ) {
    return (
      base +
      " Turn reporting interpretation has not been confirmed yet, so the records suggest a turn-progress pattern but Ascent will not treat work-order closure as turn completion until the setting is confirmed."
    );
  }
  if (mode === "separate_turns_and_work_orders" && a.analysisType === "turn_time_allocation") {
    return (
      base +
      " Work order activity may be contributing to turn progress, but the turn record itself must be reviewed separately under this organization's reporting mode."
    );
  }
  return base;
}

function buildWhyItMatters(
  a: AnalysisOutput,
  mode: TurnWorkOrderReportingModeValue,
): string {
  // Category-specific framing without dramatic / consultant language.
  if (a.bottleneckStage) {
    return (
      `When activity stalls at the ${a.bottleneckStage} stage, downstream work cannot start ` +
      `and time-to-resolution grows for every record waiting behind it. The supporting records ` +
      `below are the ones currently driving this signal.`
    );
  }
  switch (a.analysisType) {
    case "work_order_time_allocation":
      return (
        "Concentration in a few work order categories often indicates a recurring driver — " +
        "parts availability, vendor scheduling, or unresolved root causes — that can be addressed " +
        "to free up capacity for turns and PM work."
      );
    case "turn_time_allocation":
      return mode === "work_orders_measure_turn_progress"
        ? "Because this organization tracks turn progress through related work orders, delays in those work orders directly translate into longer vacancy exposure."
        : "Longer vacancy windows reduce revenue capture and compress downstream turn capacity for the next move-in.";
    case "asset_warranty_risk":
      return (
        "Assets that are aging or out of warranty represent unbudgeted replacement risk. " +
        "Surfacing them early supports planning conversations before failures force reactive spend."
      );
    case "evidence_impact":
      return (
        "Records without supporting documentation are weaker decision inputs — they slow down vendor disputes, " +
        "owner reporting, and any conversation that needs proof of what happened."
      );
    case "assignment_coverage":
      return (
        "Records that are not fully attributed to property, unit, or category cannot feed property-level " +
        "trend analysis with full certainty and should be cleaned up before they're cited in executive review."
      );
    case "cross_category_pressure":
      return (
        "When pressure shows up across multiple categories on the same property, it usually points at a " +
        "shared upstream cause — a property condition, a vendor relationship, or a staffing gap."
      );
    case "pm_time_allocation":
      return (
        "PM coverage shapes how much reactive work the team will absorb later. Gaps here often precede " +
        "work-order spikes in the same categories within a few cycles."
      );
  }
}

function buildSuggestedNextStep(
  a: AnalysisOutput,
  mode: TurnWorkOrderReportingModeValue,
): string {
  if (a.bottleneckStage) {
    return `Open the supporting records for the ${a.bottleneckStage} stage and confirm whether staffing, parts, or vendor scheduling is the driver before escalating.`;
  }
  if (a.analysisType === "work_order_time_allocation" && /turn-related/i.test(a.title)) {
    if (mode === "hybrid_or_unknown") {
      return "Open the supporting records and confirm whether these should be treated as turn progress — then set the reporting mode so this question is answered for future reports.";
    }
    return "Use this record group as the starting point for the next maintenance conversation about turn-cycle drivers.";
  }
  switch (a.analysisType) {
    case "evidence_impact":
      return "Open the supporting records and prioritise attaching documentation for the highest-priority items first.";
    case "assignment_coverage":
      return "Open the supporting records and confirm property, unit, or category assignment before relying on these for executive certainty.";
    case "asset_warranty_risk":
      return "Use these records as the starting point for the next replacement-planning conversation.";
    case "cross_category_pressure":
      return "Open the supporting records and confirm whether the pressure is concentrated on a single property or vendor relationship.";
    default:
      return "Open the supporting records and confirm whether the pattern is isolated or repeating before treating it as a confirmed trend.";
  }
}

function readinessReviewQuestion(a: AnalysisOutput): string {
  if (a.missingFields.length > 0) {
    return `Which records in this area can be re-uploaded or completed so the missing fields (${formatMissingFields(a.missingFields)}) are filled in?`;
  }
  return `What is the next upload or correction that would let Ascent generate a confirmed insight for "${a.title}"?`;
}

function readinessNextStep(a: AnalysisOutput): string {
  if (a.missingFields.length > 0) {
    return `Update or re-upload records so ${formatMissingFields(a.missingFields)} are populated, then re-run the report.`;
  }
  return "Upload more complete records for this report area, then re-run the report.";
}

function reportTypeFor(a: AnalysisOutput): string {
  switch (a.analysisType) {
    case "work_order_time_allocation":
      return "Work Order Performance";
    case "turn_time_allocation":
      return "Turn Performance";
    case "pm_time_allocation":
      return "Preventative Maintenance";
    case "asset_warranty_risk":
      return "Asset & Warranty";
    case "evidence_impact":
      return "Evidence & Documentation";
    case "assignment_coverage":
      return "Assignment Coverage";
    case "cross_category_pressure":
      return "Cross-Category Pressure";
  }
}

function sourceMetricsFor(a: AnalysisOutput): string[] {
  const out: string[] = [];
  if (a.metricValue != null) {
    out.push(`${a.title}: ${a.metricValue}${a.metricUnit ? ` ${a.metricUnit}` : ""}`);
  }
  if (a.bottleneckStage) out.push(`bottleneck_stage=${a.bottleneckStage}`);
  if (a.primaryCategory) out.push(`primary_category=${a.primaryCategory}`);
  if (a.timeAllocationShare != null) {
    out.push(`time_allocation_share=${a.timeAllocationShare}`);
  }
  if (a.estimatedTimeImpactHours != null) {
    out.push(`estimated_time_impact_hours=${a.estimatedTimeImpactHours}`);
  }
  for (const f of a.contributingFactors.slice(0, 3)) {
    out.push(`${f.label}=${f.displayValue}`);
  }
  return out;
}

// ─── Empty / low-data state ───────────────────────────────────────────────────

function buildEmptyState(
  analyses: AnalysisOutput[],
  insights: NarrativeInsight[],
): NarrativeInsightsBundle["emptyState"] {
  const totals = analyses.reduce(
    (acc, a) => {
      acc.fully += a.fullyReportableRecordCount;
      acc.partial += a.partiallyReportableRecordCount;
      acc.notYet += a.excludedRecordCount;
      for (const f of a.missingFields) acc.missing.add(f);
      return acc;
    },
    { fully: 0, partial: 0, notYet: 0, missing: new Set<string>() },
  );
  const recordsUploaded = totals.fully + totals.partial + totals.notYet;
  const operationalInsightCount = insights.filter(
    (i) => i.dataSupportLevel !== "not_enough_data",
  ).length;
  const isEmpty = operationalInsightCount === 0;
  return {
    isEmpty,
    message: isEmpty
      ? "No narrative insights are available yet because Ascent does not have enough reportable records for this report."
      : `${operationalInsightCount} narrative insight(s) generated from the latest reporting analysis.`,
    recordsUploaded,
    fullyReportableRecords: totals.fully,
    partiallyReportableRecords: totals.partial,
    notReportableYetRecords: totals.notYet,
    missingFieldsBlockingInsights: Array.from(totals.missing).slice(0, 10),
    suggestedNextUpload: isEmpty
      ? "Upload more complete records — make sure property, unit, category, status, and key dates are populated — then re-run the report."
      : "Continue improving partial records to upgrade directional insights to confirmed insights.",
  };
}

// ─── Misc helpers ─────────────────────────────────────────────────────────────

function formatMissingFields(codes: string[]): string {
  const pretty = codes.slice(0, 4).map((c) => c.replace(/_/g, " "));
  if (pretty.length === 0) return "required fields";
  if (pretty.length === 1) return pretty[0]!;
  return `${pretty.slice(0, -1).join(", ")} and ${pretty[pretty.length - 1]!}`;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function severityRank(s: InsightSeverity): number {
  return { informational: 0, watch: 1, needs_review: 2, priority: 3, critical: 4 }[s];
}
function confidenceRank(c: InsightConfidence): number {
  return { low: 0, medium: 1, high: 2 }[c];
}

// Exports used only by tests (kept internal to the module otherwise).
export const _internals = {
  mapInsightCategory,
  mapSeverity,
  mapDataSupport,
  buildReportabilityBreakdown,
  buildLimitationText,
};
