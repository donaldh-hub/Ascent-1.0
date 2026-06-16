/**
 * Ascent 8.2 — Trend + Pattern Analyzer
 *
 * Surfaces recurring patterns in the normalized record pool:
 *   - Top categories by frequency
 *   - Properties ranked by record volume
 *   - Aging records (ageDays > 30, not completed)
 *   - Recurring bottleneck categories appearing in both work orders and turns
 *
 * Pure function — no DB calls. Takes the normalized record pool as input.
 */

import type { NormalizedReportingRecord } from "./reporting-record-contract.js";

// ─── Output shapes ────────────────────────────────────────────────────────────

export interface CategoryFrequency {
  category: string;
  count: number;
  percentOfTotal: number;
}

export interface PropertyVolume {
  propertyId: number | null;
  propertyName: string;
  recordCount: number;
  fullyReportable: number;
  partial: number;
}

export interface AgingRecord {
  id: string;
  sourceType: string;
  sourceRecordId: number | string;
  propertyName: string | null;
  status: string | null;
  ageDays: number;
  category: string | null;
}

export interface RecurringBottleneck {
  category: string;
  workOrderCount: number;
  turnCount: number;
  totalCount: number;
}

export type TrendConfidence = "sufficient" | "directional" | "insufficient";

export interface TrendPatternReport {
  generatedAt: string;
  trendWindow: string;
  trendConfidence: TrendConfidence;
  admissibleRecordCount: number;
  topCategories: CategoryFrequency[];
  propertiesByVolume: PropertyVolume[];
  agingRecords: AgingRecord[];
  agingRecordCount: number;
  recurringBottlenecks: RecurringBottleneck[];
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

// ─── Main function ────────────────────────────────────────────────────────────

export function analyzeTrends(records: NormalizedReportingRecord[]): TrendPatternReport {
  const now = new Date().toISOString();
  const trendWindow = "30 days";

  // Admissible = fully or partially reportable
  const admissible = records.filter(
    (r) => r.reportingEligibility === "fully_reportable" || r.reportingEligibility === "partially_reportable",
  );

  const admissibleCount = admissible.length;

  const trendConfidence: TrendConfidence =
    admissibleCount >= 50
      ? "sufficient"
      : admissibleCount >= 10
      ? "directional"
      : "insufficient";

  // ── Top categories (work orders + turns only for category relevance) ──────────
  const categoryCount = new Map<string, number>();
  for (const r of admissible) {
    const cat = r.category;
    if (!cat) continue;
    categoryCount.set(cat, (categoryCount.get(cat) ?? 0) + 1);
  }
  const totalWithCategory = [...categoryCount.values()].reduce((s, n) => s + n, 0);
  const topCategories: CategoryFrequency[] = [...categoryCount.entries()]
    .map(([category, count]) => ({
      category,
      count,
      percentOfTotal: totalWithCategory === 0 ? 0 : Math.round((count / totalWithCategory) * 100),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // ── Properties by volume ──────────────────────────────────────────────────────
  const propMap = new Map<
    string,
    { propertyId: number | null; propertyName: string; total: number; fully: number; partial: number }
  >();
  for (const r of records) {
    const key = r.propertyId != null ? String(r.propertyId) : "__none__";
    const name = r.propertyName ?? (r.propertyId != null ? `Property ${r.propertyId}` : "No property");
    if (!propMap.has(key)) {
      propMap.set(key, { propertyId: r.propertyId, propertyName: name, total: 0, fully: 0, partial: 0 });
    }
    const entry = propMap.get(key)!;
    entry.total += 1;
    if (r.reportingEligibility === "fully_reportable") entry.fully += 1;
    else if (r.reportingEligibility === "partially_reportable") entry.partial += 1;
  }
  const propertiesByVolume: PropertyVolume[] = [...propMap.values()]
    .map((v) => ({
      propertyId: v.propertyId,
      propertyName: v.propertyName,
      recordCount: v.total,
      fullyReportable: v.fully,
      partial: v.partial,
    }))
    .sort((a, b) => b.recordCount - a.recordCount)
    .slice(0, 20);

  // ── Aging records: ageDays > 30 and not in terminal status ───────────────────
  const agingAll: AgingRecord[] = [];
  for (const r of admissible) {
    if (r.ageDays != null && r.ageDays > 30 && !isTerminal(r.status)) {
      agingAll.push({
        id: r.id,
        sourceType: r.sourceType,
        sourceRecordId: r.sourceRecordId,
        propertyName: r.propertyName,
        status: r.status,
        ageDays: r.ageDays,
        category: r.category,
      });
    }
  }
  agingAll.sort((a, b) => b.ageDays - a.ageDays);
  const agingRecords = agingAll.slice(0, 50);

  // ── Recurring bottlenecks: categories in both work orders AND turns ───────────
  const woCats = new Map<string, number>();
  const turnCats = new Map<string, number>();
  for (const r of admissible) {
    if (!r.category) continue;
    if (r.sourceType === "work_orders") {
      woCats.set(r.category, (woCats.get(r.category) ?? 0) + 1);
    } else if (r.sourceType === "turns") {
      turnCats.set(r.category, (turnCats.get(r.category) ?? 0) + 1);
    }
  }
  const recurringBottlenecks: RecurringBottleneck[] = [];
  for (const [cat, woCount] of woCats.entries()) {
    const turnCount = turnCats.get(cat);
    if (turnCount != null && turnCount > 0) {
      recurringBottlenecks.push({
        category: cat,
        workOrderCount: woCount,
        turnCount,
        totalCount: woCount + turnCount,
      });
    }
  }
  recurringBottlenecks.sort((a, b) => b.totalCount - a.totalCount);

  return {
    generatedAt: now,
    trendWindow,
    trendConfidence,
    admissibleRecordCount: admissibleCount,
    topCategories,
    propertiesByVolume,
    agingRecords,
    agingRecordCount: agingAll.length,
    recurringBottlenecks,
  };
}
