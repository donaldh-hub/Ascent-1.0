/**
 * Ascent 7.2 — Cross-Category Operational Pressure Analyzer
 *
 * Compares pressure across work orders, turns, PM, asset risk, evidence
 * gaps, and assignment gaps to surface concentrated operational drag.
 *
 * Language is intentionally careful: this analyzer suggests patterns and
 * recommends review — it never claims causation.
 *
 *   ALLOWED:  "may be contributing", "suggests a possible relationship",
 *             "review this pattern", "appears to be a pressure point".
 *   NOT ALLOWED: unsupported causation, fake certainty, generic advice.
 */

import {
  type AnalysisOutput,
  type ContributingFactor,
  makeAnalysisId,
  weakestConfidenceState,
} from "./analysis-output-contract.js";

const SURFACES = [
  "reports_page",
  "control_tower",
  "operational_health_tile",
  "priority_actions_panel",
] as const;

export interface CrossCategoryInputs {
  workOrders: AnalysisOutput[];
  turns: AnalysisOutput[];
  pm: AnalysisOutput[];
  assets: AnalysisOutput[];
  evidence: AnalysisOutput[];
  assignments: AnalysisOutput[];
}

/**
 * Cross-category pressure synthesises the per-category analyses. It does
 * NOT re-read raw records — it derives its signal entirely from the
 * confidence state and metric values of the inputs, which guarantees:
 *   - never invents data
 *   - never silently mixes eligibility tiers
 *   - automatically demotes to qualified/insufficient when any input is.
 */
export function analyseCrossCategoryPressure(inputs: CrossCategoryInputs): AnalysisOutput[] {
  const factors: ContributingFactor[] = [];
  const supportingRecordIds: string[] = [];

  const considerTop = (analyses: AnalysisOutput[], label: string) => {
    const top = analyses
      .filter((a) => a.confidenceState !== "insufficient_data" && a.metricValue != null)
      .sort((a, b) => (b.metricValue ?? 0) - (a.metricValue ?? 0))[0];
    if (!top) return;
    factors.push({
      label: `${label}: ${top.title}`,
      displayValue: top.summary,
      numericValue: top.metricValue ?? 0,
      supportingRecordIds: top.supportingRecordIds.slice(0, 50),
    });
    supportingRecordIds.push(...top.supportingRecordIds.slice(0, 50));
  };

  considerTop(inputs.workOrders, "Work order pressure");
  considerTop(inputs.turns, "Turn pressure");
  considerTop(inputs.pm, "PM coverage");
  considerTop(inputs.assets, "Asset / warranty risk");
  considerTop(inputs.evidence, "Evidence weakness");
  considerTop(inputs.assignments, "Assignment / data-quality weakness");

  // Counts MUST be deduped per source record id. Each per-category engine
  // typically emits multiple analyses over the same record set (e.g. the
  // work-order engine emits 4 analyses, all backed by the same 75 work
  // orders). Summing fullyReportableRecordCount naively across analyses
  // would inflate totals 4x and misrepresent the reportability basis.
  //
  // We dedupe by category — taking the FIRST analysis per analysisType as
  // the representative — then sum the category-level counts.
  const repByType = new Map<string, AnalysisOutput>();
  for (const a of allAnalyses(inputs)) {
    if (!repByType.has(a.analysisType)) repByType.set(a.analysisType, a);
  }
  const reps = [...repByType.values()];
  const totalFully = reps.reduce((s, a) => s + a.fullyReportableRecordCount, 0);
  const totalPartial = reps.reduce((s, a) => s + a.partiallyReportableRecordCount, 0);
  const totalExcluded = reps.reduce((s, a) => s + a.excludedRecordCount, 0);

  // Confidence inherits the WEAKEST input — any insufficient category
  // poisons the cross-category claim, since we cannot honestly assert
  // pressure across categories some of which we know nothing about.
  // factors.length===0 means no engine had an admissible signal at all.
  const inputStates = allAnalyses(inputs).map((a) => a.confidenceState);
  const confidenceState: AnalysisOutput["confidenceState"] = factors.length === 0
    ? "insufficient_data"
    : weakestConfidenceState(inputStates);

  const summary =
    factors.length === 0
      ? "Not enough reportable records across categories to identify cross-category pressure yet."
      : "The data suggests operational pressure may be concentrated in the categories listed below. " +
        "Review the supporting records before taking action — confidence is limited where partial or " +
        "missing records contributed.";

  const now = new Date().toISOString();
  return [
    {
      analysisId: makeAnalysisId("cross_category_pressure", "overview"),
      analysisType: "cross_category_pressure",
      sourceCategory: "multi",
      organizationId: null,
      propertyId: null,
      unitId: null,
      dateRange: { startIso: null, endIso: null },
      title: "Cross-category operational pressure",
      summary,
      metricValue: factors.length,
      metricUnit: "pressure signals",
      comparisonValue: null,
      trendDirection: null,
      timeAllocationShare: null,
      estimatedTimeImpactHours: null,
      bottleneckStage: null,
      primaryCategory: null,
      contributingFactors: factors,
      confidenceState,
      reportabilityBasis: {
        admitted:
          totalFully > 0 && totalPartial > 0
            ? ["fully_reportable", "partially_reportable"]
            : totalFully > 0
            ? ["fully_reportable"]
            : totalPartial > 0
            ? ["partially_reportable"]
            : [],
        explanation:
          factors.length === 0
            ? "No category had enough admissible records to feed cross-category analysis."
            : `Derived from ${factors.length} per-category top signals. Underlying mix: ${totalFully} fully, ${totalPartial} partial, ${totalExcluded} excluded across categories. Reduce ambiguity by uploading more complete records.`,
      },
      fullyReportableRecordCount: totalFully,
      partiallyReportableRecordCount: totalPartial,
      excludedRecordCount: totalExcluded,
      missingFields: [],
      supportingRecordIds: dedupe(supportingRecordIds),
      supportingRecordCount: dedupe(supportingRecordIds).length,
      recommendedReviewQuestion:
        "Which category should be addressed first given the current pressure mix, and what supporting records confirm it?",
      compatibleSurfaces: [...SURFACES],
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function allAnalyses(inputs: CrossCategoryInputs): AnalysisOutput[] {
  return [
    ...inputs.workOrders,
    ...inputs.turns,
    ...inputs.pm,
    ...inputs.assets,
    ...inputs.evidence,
    ...inputs.assignments,
  ];
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
