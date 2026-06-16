/**
 * Ascent 8.0 — Impact Recalculation Engine
 *
 * Pure calculation layer — no DB calls. Takes the normalized record pool
 * and projects what scores/signals would change if records were recalculated.
 *
 * Uses the same risk-scoring concept from evidence-context-analyzer.ts for
 * the missingEvidenceImpact ranking.
 */

import type { NormalizedReportingRecord } from "./reporting-record-contract.js";

// ─── Output shapes ────────────────────────────────────────────────────────────

export interface StalenessRecord {
  id: string;
  sourceType: string;
  sourceRecordId: number | string;
  propertyName: string | null;
  status: string | null;
  ageDays: number;
  updatedAt: string;
}

export interface RecentChangeRecord {
  id: string;
  sourceType: string;
  sourceRecordId: number | string;
  propertyName: string | null;
  status: string | null;
  ageDays: number;
  updatedAt: string;
}

export interface CompletionImpactRecord {
  id: string;
  sourceType: string;
  sourceRecordId: number | string;
  propertyName: string | null;
  status: string;
  completedAt: string | null;
  affectedAnalysisCategories: string[];
}

export interface MissingEvidenceRecord {
  id: string;
  sourceType: string;
  sourceRecordId: number | string;
  propertyName: string | null;
  status: string | null;
  riskScore: number;
  riskReason: string;
}

export interface ImpactSnapshot {
  generatedAt: string;
  /** Records where updatedAt > 7 days old and status has not changed to terminal state */
  staleness: StalenessRecord[];
  stalenessCount: number;
  /** Records updated within the last 7 days (ageDays < 7) */
  recentChanges: RecentChangeRecord[];
  recentChangesCount: number;
  /** Records that recently moved to completed/resolved status */
  completionImpact: CompletionImpactRecord[];
  completionImpactCount: number;
  /** Records without supporting docs ranked by risk */
  missingEvidenceImpact: MissingEvidenceRecord[];
  missingEvidenceImpactCount: number;
  /** True when any staleness detected */
  recalculationNeeded: boolean;
  /** Warning message when stale records exist */
  staleCalculationWarning: string | null;
}

// ─── Risk scoring (mirrors evidence-context-analyzer approach) ────────────────

function scoreEvidenceRisk(r: NormalizedReportingRecord): { score: number; reason: string } {
  let score = 0;
  let reason = "No supporting documents attached";

  if (r.reportingEligibility === "fully_reportable") {
    score += 50;
    reason = "Fully reportable record with no supporting documentation";
  } else if (r.reportingEligibility === "partially_reportable") {
    score += 25;
    reason = "Partially reportable record with no supporting documentation";
  }

  if (r.sourceType === "assets") {
    score += 30;
    reason = "Asset record with no documentation (physical verification risk)";
  } else if (r.sourceType === "turns") {
    score += 20;
    reason = "Turn record without supporting documentation";
  } else if (r.sourceType === "work_orders") {
    score += 15;
  } else if (r.sourceType === "preventative_maintenance") {
    score += 20;
    reason = "PM record without completion documentation";
  }

  if (r.ageDays != null && r.ageDays > 30) {
    score += 10;
    reason += ` — record is ${Math.round(r.ageDays)} days old`;
  }

  return { score: Math.min(score, 100), reason };
}

// ─── Terminal status detection ────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set([
  "completed",
  "resolved",
  "closed",
  "done",
  "complete",
  "finished",
  "cancelled",
  "canceled",
]);

function isTerminal(status: string | null): boolean {
  if (!status) return false;
  return TERMINAL_STATUSES.has(status.toLowerCase().trim());
}

function isRecentlyCompleted(r: NormalizedReportingRecord): boolean {
  if (!isTerminal(r.status)) return false;
  // Consider "recently" as ageDays < 7, or completedAt within 7 days
  if (r.ageDays != null && r.ageDays < 7) return true;
  if (r.completedAt) {
    const diffMs = Date.now() - new Date(r.completedAt).getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays < 7;
  }
  return false;
}

// ─── Analysis category mapping ────────────────────────────────────────────────

function affectedCategories(r: NormalizedReportingRecord): string[] {
  switch (r.sourceType) {
    case "work_orders":
      return ["work_order_time_allocation", "cross_category_pressure"];
    case "turns":
      return ["turn_time_allocation", "cross_category_pressure"];
    case "preventative_maintenance":
      return ["pm_time_allocation"];
    case "assets":
      return ["asset_warranty_risk"];
    case "documents":
      return ["evidence_impact"];
    case "assignments":
      return ["assignment_coverage"];
    default:
      return [];
  }
}

// ─── Main function ────────────────────────────────────────────────────────────

export function calculateImpactSnapshot(records: NormalizedReportingRecord[]): ImpactSnapshot {
  const now = new Date();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  // ── Staleness: updatedAt > 7 days ago AND not in terminal state ──────────────
  const staleRecords: StalenessRecord[] = [];
  for (const r of records) {
    if (isTerminal(r.status)) continue;
    if (!r.updatedAt) continue;
    const ageMs = now.getTime() - new Date(r.updatedAt).getTime();
    if (ageMs > sevenDaysMs) {
      staleRecords.push({
        id: r.id,
        sourceType: r.sourceType,
        sourceRecordId: r.sourceRecordId,
        propertyName: r.propertyName,
        status: r.status,
        ageDays: r.ageDays ?? Math.round(ageMs / (1000 * 60 * 60 * 24)),
        updatedAt: r.updatedAt.toISOString(),
      });
    }
  }

  // ── Recent changes: ageDays < 7 ──────────────────────────────────────────────
  const recentRecords: RecentChangeRecord[] = [];
  for (const r of records) {
    if (r.ageDays != null && r.ageDays < 7) {
      recentRecords.push({
        id: r.id,
        sourceType: r.sourceType,
        sourceRecordId: r.sourceRecordId,
        propertyName: r.propertyName,
        status: r.status,
        ageDays: r.ageDays,
        updatedAt: r.updatedAt ? r.updatedAt.toISOString() : "",
      });
    }
  }

  // ── Completion impact: recently moved to terminal status ─────────────────────
  const completionRecords: CompletionImpactRecord[] = [];
  for (const r of records) {
    if (isRecentlyCompleted(r)) {
      completionRecords.push({
        id: r.id,
        sourceType: r.sourceType,
        sourceRecordId: r.sourceRecordId,
        propertyName: r.propertyName,
        status: r.status ?? "completed",
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
        affectedAnalysisCategories: affectedCategories(r),
      });
    }
  }

  // ── Missing evidence impact: admissible records without docs, ranked ──────────
  // We detect "document" source types as the evidence set; operational records
  // without a corresponding document record are flagged.
  const documentIds = new Set(
    records
      .filter((r) => r.sourceType === "documents")
      .map((r) => String(r.sourceRecordId)),
  );

  const operationalSourceTypes = new Set([
    "work_orders",
    "turns",
    "preventative_maintenance",
    "assets",
    "assignments",
  ]);

  const missingEvidenceRecords: MissingEvidenceRecord[] = [];
  for (const r of records) {
    if (!operationalSourceTypes.has(r.sourceType)) continue;
    if (r.reportingEligibility === "not_reportable") continue;
    // Check if any document links back to this record (by sourceRecordId match)
    const hasEvidence = documentIds.has(String(r.sourceRecordId));
    if (!hasEvidence) {
      const { score, reason } = scoreEvidenceRisk(r);
      missingEvidenceRecords.push({
        id: r.id,
        sourceType: r.sourceType,
        sourceRecordId: r.sourceRecordId,
        propertyName: r.propertyName,
        status: r.status,
        riskScore: score,
        riskReason: reason,
      });
    }
  }
  missingEvidenceRecords.sort((a, b) => b.riskScore - a.riskScore);

  const recalculationNeeded = staleRecords.length > 0;
  const staleCalculationWarning = recalculationNeeded
    ? `${staleRecords.length} record${staleRecords.length === 1 ? "" : "s"} have not been updated in over 7 days and may carry stale scores. Review and update them to ensure reporting accuracy.`
    : null;

  return {
    generatedAt: now.toISOString(),
    staleness: staleRecords,
    stalenessCount: staleRecords.length,
    recentChanges: recentRecords,
    recentChangesCount: recentRecords.length,
    completionImpact: completionRecords,
    completionImpactCount: completionRecords.length,
    missingEvidenceImpact: missingEvidenceRecords.slice(0, 100),
    missingEvidenceImpactCount: missingEvidenceRecords.length,
    recalculationNeeded,
    staleCalculationWarning,
  };
}
