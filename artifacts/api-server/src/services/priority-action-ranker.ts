/**
 * Ascent 8.1 — Priority Action Ranker
 *
 * Produces a ranked list of priority actions from the analysis bundle.
 * Actions are ranked by urgency (critical > warning > info), then by
 * supporting record count descending. Capped at 10 actions, one per
 * sourceCategory max.
 */

import type { ReportingAnalysisBundle } from "./reporting-analysis-service.js";
import type { AnalysisOutput, AnalysisConfidenceState } from "./analysis-output-contract.js";
import { flattenBundle } from "./reporting-analysis-service.js";

// ─── Output shapes ────────────────────────────────────────────────────────────

export type PriorityActionUrgency = "critical" | "warning" | "info";

export interface PriorityAction {
  rank: number;
  category: string;
  title: string;
  reason: string;
  recordCount: number;
  urgency: PriorityActionUrgency;
  analysisId: string;
}

export interface PriorityActionList {
  generatedAt: string;
  actions: PriorityAction[];
  totalActionsConsidered: number;
}

// ─── Urgency derivation ───────────────────────────────────────────────────────

function deriveUrgency(
  confidenceState: AnalysisConfidenceState,
  recordCount: number,
): PriorityActionUrgency {
  // insufficient_data analyses are already excluded upstream
  if (confidenceState === "confirmed_analysis") {
    // Confirmed with high record count → might be critical if many records need attention
    return recordCount >= 50 ? "critical" : recordCount >= 10 ? "warning" : "info";
  }
  // qualified_analysis = data is directional but partial
  return recordCount >= 20 ? "warning" : "info";
}

function urgencyRank(u: PriorityActionUrgency): number {
  switch (u) {
    case "critical": return 3;
    case "warning": return 2;
    case "info": return 1;
  }
}

// ─── Reason generation ────────────────────────────────────────────────────────

function buildReason(analysis: AnalysisOutput): string {
  const count = analysis.supportingRecordCount;
  const confidence = analysis.confidenceState;

  if (confidence === "qualified_analysis" && count > 0) {
    return `${count} ${analysis.sourceCategory.replace(/_/g, " ")} record${count === 1 ? "" : "s"} contribute to a qualified signal — confidence can be improved by resolving missing fields.`;
  }

  if (analysis.missingFields.length > 0) {
    const topMissing = analysis.missingFields.slice(0, 2).join(", ");
    return `${count} record${count === 1 ? "" : "s"} are missing key fields (${topMissing}) — resolving these will strengthen reporting confidence.`;
  }

  if (analysis.bottleneckStage) {
    return `${count} record${count === 1 ? "" : "s"} show a bottleneck at "${analysis.bottleneckStage}". Reviewing these records may improve the analysis score.`;
  }

  if (count > 0) {
    return `${count} ${analysis.sourceCategory.replace(/_/g, " ")} record${count === 1 ? "" : "s"} are tracked in this analysis. Review to ensure data quality.`;
  }

  return `Review ${analysis.sourceCategory.replace(/_/g, " ")} records for this analysis to improve reporting confidence.`;
}

// ─── Main function ────────────────────────────────────────────────────────────

export function rankPriorityActions(bundle: ReportingAnalysisBundle): PriorityActionList {
  const all = flattenBundle(bundle);

  // Filter: must have data and non-insufficient confidence
  const eligible = all.filter(
    (a) =>
      a.confidenceState !== "insufficient_data" &&
      a.supportingRecordCount > 0,
  );

  // De-duplicate: one action per sourceCategory (keep highest record count)
  const byCategoryMap = new Map<string, AnalysisOutput>();
  for (const a of eligible) {
    const existing = byCategoryMap.get(a.sourceCategory);
    if (!existing || a.supportingRecordCount > existing.supportingRecordCount) {
      byCategoryMap.set(a.sourceCategory, a);
    }
  }

  const candidates = [...byCategoryMap.values()];

  // Build actions with urgency
  const withUrgency = candidates.map((a) => {
    const urgency = deriveUrgency(a.confidenceState, a.supportingRecordCount);
    return {
      category: a.sourceCategory,
      title: a.title,
      reason: buildReason(a),
      recordCount: a.supportingRecordCount,
      urgency,
      analysisId: a.analysisId,
      _urgencyRank: urgencyRank(urgency),
    };
  });

  // Sort: urgency DESC, then record count DESC
  withUrgency.sort((a, b) => {
    if (b._urgencyRank !== a._urgencyRank) return b._urgencyRank - a._urgencyRank;
    return b.recordCount - a.recordCount;
  });

  // Cap at 10, assign ranks
  const actions: PriorityAction[] = withUrgency.slice(0, 10).map((a, i) => ({
    rank: i + 1,
    category: a.category,
    title: a.title,
    reason: a.reason,
    recordCount: a.recordCount,
    urgency: a.urgency,
    analysisId: a.analysisId,
  }));

  return {
    generatedAt: bundle.generatedAt,
    actions,
    totalActionsConsidered: eligible.length,
  };
}
