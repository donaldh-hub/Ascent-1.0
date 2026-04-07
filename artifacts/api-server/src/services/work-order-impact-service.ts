/**
 * Build 2.6 — Work Order Impact + Priority Engine
 *
 * Transforms raw work order data into ranked, scored, explainable priorities.
 *
 * Formula:
 *   Impact Score = timeOpen × categoryWeight × blockMultiplier × priorityMultiplier × repeatMultiplier
 *
 * Aggregates to:
 *   - Per-record score + tier + explanation
 *   - Category-level impact
 *   - Property-level ranking
 *   - Top-3 portfolio priority list
 */

import { db } from "@workspace/db";
import {
  workOrdersTable,
  propertiesTable,
} from "@workspace/db/schema";
import { ne, inArray } from "drizzle-orm";

// ─── Weight tables (deterministic, future-configurable) ───────────────────────

export const CATEGORY_WEIGHTS: Record<string, number> = {
  Maintenance: 1.0,
  HVAC: 1.2,
  Plumbing: 1.1,
  Electrical: 1.1,
  Appliance: 1.2,
  Turn: 1.3,
  "Make-Ready": 1.3,
  Flooring: 1.1,
  Cleaning: 0.9,
  Painting: 0.9,
  Inspection: 1.0,
  Rework: 1.4,
  General: 0.8,
};

export const PRIORITY_MULTIPLIERS: Record<string, number> = {
  critical: 2.0,
  high: 1.5,
  medium: 1.0,
  low: 0.7,
};

export const BLOCK_MULTIPLIERS = {
  blocked: 1.8,
  stalled: 1.3,
  normal: 1.0,
};

const REPEAT_MULTIPLIER = 1.25;

// ─── Impact tiers ─────────────────────────────────────────────────────────────

export type ImpactTier = "low" | "medium" | "high" | "critical";

export function impactTier(score: number): ImpactTier {
  if (score >= 50) return "critical";
  if (score >= 20) return "high";
  if (score >= 5)  return "medium";
  return "low";
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface WorkOrderImpactRow {
  id: number;
  externalId: string | null;
  category: string;
  description: string | null;
  priority: string;
  status: string;
  isBlocked: boolean;
  bottleneckType: string | null;
  stage: string | null;
  daysInStage: number | null;
  createdDate: Date | null;
  propertyId: number | null;
  propertyName: string | null;
  propertyNameRaw: string | null;
  unitId: number | null;
  unitNumber: string | null;
  turnId: string | null;
  delayReason: string | null;
  slaStatus: string;
  impactScore: number;
  impactTier: ImpactTier;
  explanation: string;
}

export interface CategoryImpact {
  category: string;
  totalImpact: number;
  avgImpact: number;
  count: number;
  blockedCount: number;
  blockedRatio: number;
  tier: ImpactTier;
  explanation: string;
  topContributors: { id: number; description: string | null; impactScore: number; propertyName: string | null }[];
}

export interface PropertyImpact {
  propertyId: number | null;
  propertyName: string;
  totalImpact: number;
  avgImpact: number;
  count: number;
  blockedCount: number;
  rank: number;
  primaryCategory: string;
  tier: ImpactTier;
  explanation: string;
}

export interface TopPriority {
  rank: number;
  label: string;
  category: string;
  propertyName: string;
  impactScore: number;
  tier: ImpactTier;
  count: number;
  blockedCount: number;
  reason: string;
  contributingIds: number[];
}

export interface WorkOrderImpactAnalysis {
  generatedAt: string;
  totalImpact: number;
  avgImpact: number;
  topPriorities: TopPriority[];
  categoryImpact: CategoryImpact[];
  propertyImpact: PropertyImpact[];
  rows: WorkOrderImpactRow[];
  hasData: boolean;
}

// ─── Core impact computation ───────────────────────────────────────────────────

function computeDaysOpen(wo: {
  daysInStage: number | null;
  createdDate: Date | null;
  status: string;
}): number {
  // Prefer explicit daysInStage if available
  if (wo.daysInStage != null && wo.daysInStage > 0) return wo.daysInStage;
  // Fall back to total days since creation
  if (wo.createdDate) {
    const days = (Date.now() - new Date(wo.createdDate).getTime()) / 86_400_000;
    return Math.max(0, Math.round(days));
  }
  return 1; // minimum 1 day to prevent zero scores
}

function computeImpactScore(wo: {
  category: string | null;
  priority: string;
  isBlocked: boolean;
  stageStatus: string | null;
  daysInStage: number | null;
  createdDate: Date | null;
  status: string;
  isRepeat?: boolean;
}): { score: number; tier: ImpactTier; explanation: string } {
  const days = computeDaysOpen(wo);
  const category = wo.category ?? "General";
  const catWeight = CATEGORY_WEIGHTS[category] ?? 1.0;
  const priorityMult = PRIORITY_MULTIPLIERS[wo.priority] ?? 1.0;

  let blockMult = BLOCK_MULTIPLIERS.normal;
  let blockLabel = "";
  if (wo.isBlocked) {
    blockMult = BLOCK_MULTIPLIERS.blocked;
    blockLabel = " with active block";
  } else if (wo.stageStatus === "stalled") {
    blockMult = BLOCK_MULTIPLIERS.stalled;
    blockLabel = " (stalled)";
  }

  const repeatMult = wo.isRepeat ? REPEAT_MULTIPLIER : 1.0;

  const raw = days * catWeight * blockMult * priorityMult * repeatMult;
  const score = Math.round(raw * 10) / 10;
  const tier = impactTier(score);

  const repeatNote = wo.isRepeat ? ", repeat issue" : "";
  const explanation = `${tier.charAt(0).toUpperCase() + tier.slice(1)} impact — ${days}d open${blockLabel}, ${wo.priority} priority ${category}${repeatNote}`;

  return { score, tier, explanation };
}

// ─── Main analysis function ────────────────────────────────────────────────────

export async function buildImpactAnalysis(): Promise<WorkOrderImpactAnalysis> {
  const wos = await db.select({
    id: workOrdersTable.id,
    externalId: workOrdersTable.externalId,
    category: workOrdersTable.category,
    description: workOrdersTable.description,
    priority: workOrdersTable.priority,
    status: workOrdersTable.status,
    isBlocked: workOrdersTable.isBlocked,
    bottleneckType: workOrdersTable.bottleneckType,
    stageStatus: workOrdersTable.stageStatus,
    stage: workOrdersTable.stage,
    daysInStage: workOrdersTable.daysInStage,
    createdDate: workOrdersTable.createdDate,
    propertyId: workOrdersTable.propertyId,
    propertyNameRaw: workOrdersTable.propertyNameRaw,
    unitId: workOrdersTable.unitId,
    turnId: workOrdersTable.turnId,
    delayReason: workOrdersTable.delayReason,
    slaStatus: workOrdersTable.slaStatus,
  }).from(workOrdersTable);

  const active = wos.filter(w => w.status !== "completed" && w.status !== "cancelled");

  if (active.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      totalImpact: 0,
      avgImpact: 0,
      topPriorities: [],
      categoryImpact: [],
      propertyImpact: [],
      rows: [],
      hasData: false,
    };
  }

  // Build repeat signal: same unitId + category appearing more than once
  const repeatKey = (wo: { unitId: number | null; category: string | null }) =>
    `${wo.unitId ?? "?"}::${wo.category ?? "General"}`;
  const keyCounts = new Map<string, number>();
  for (const wo of active) keyCounts.set(repeatKey(wo), (keyCounts.get(repeatKey(wo)) ?? 0) + 1);

  // Fetch property names for propertyId references
  const propIds = [...new Set(active.map(w => w.propertyId).filter(Boolean))] as number[];
  const props = propIds.length
    ? await db.select({ id: propertiesTable.id, name: propertiesTable.name })
        .from(propertiesTable)
        .where(inArray(propertiesTable.id, propIds))
    : [];
  const propMap = new Map(props.map(p => [p.id, p.name]));

  // Score each record
  const scored: WorkOrderImpactRow[] = active.map(wo => {
    const isRepeat = (keyCounts.get(repeatKey(wo)) ?? 1) > 1;
    const { score, tier, explanation } = computeImpactScore({ ...wo, isRepeat });
    const resolvedName = propMap.get(wo.propertyId ?? -1) ?? wo.propertyNameRaw ?? "Unknown Property";
    return {
      id: wo.id,
      externalId: wo.externalId,
      category: wo.category ?? "General",
      description: wo.description,
      priority: wo.priority,
      status: wo.status,
      isBlocked: wo.isBlocked,
      bottleneckType: wo.bottleneckType,
      stage: wo.stage,
      daysInStage: wo.daysInStage,
      createdDate: wo.createdDate,
      propertyId: wo.propertyId,
      propertyName: resolvedName,
      propertyNameRaw: wo.propertyNameRaw,
      unitId: wo.unitId,
      unitNumber: null,
      turnId: wo.turnId,
      delayReason: wo.delayReason,
      slaStatus: wo.slaStatus,
      impactScore: score,
      impactTier: tier,
      explanation,
    };
  });

  // Sort scored rows by impact descending
  scored.sort((a, b) => b.impactScore - a.impactScore);

  // ── Category impact ─────────────────────────────────────────────────────────

  const catMap = new Map<string, WorkOrderImpactRow[]>();
  for (const r of scored) {
    if (!catMap.has(r.category)) catMap.set(r.category, []);
    catMap.get(r.category)!.push(r);
  }

  const categoryImpact: CategoryImpact[] = Array.from(catMap.entries())
    .map(([category, rows]) => {
      const totalImpact = Math.round(rows.reduce((s, r) => s + r.impactScore, 0) * 10) / 10;
      const avgImpact = Math.round((totalImpact / rows.length) * 10) / 10;
      const blockedCount = rows.filter(r => r.isBlocked).length;
      const blockedRatio = Math.round((blockedCount / rows.length) * 100);
      const tier = impactTier(avgImpact);
      const topContributors = rows.slice(0, 3).map(r => ({
        id: r.id,
        description: r.description,
        impactScore: r.impactScore,
        propertyName: r.propertyName,
      }));

      let explanation: string;
      if (blockedRatio >= 50) {
        explanation = `${category} is highest impact — ${blockedCount} of ${rows.length} records blocked (${blockedRatio}% blocked ratio)`;
      } else if (rows.some(r => r.impactTier === "critical")) {
        explanation = `${category} contains critical-impact records with high age and priority`;
      } else {
        explanation = `${category} backlog with ${rows.length} open records averaging ${avgImpact} impact score`;
      }

      return { category, totalImpact, avgImpact, count: rows.length, blockedCount, blockedRatio, tier, explanation, topContributors };
    })
    .sort((a, b) => b.totalImpact - a.totalImpact);

  // ── Property impact ─────────────────────────────────────────────────────────

  const propGroupMap = new Map<string, WorkOrderImpactRow[]>();
  for (const r of scored) {
    const key = r.propertyName;
    if (!propGroupMap.has(key)) propGroupMap.set(key, []);
    propGroupMap.get(key)!.push(r);
  }

  const propertyImpact: PropertyImpact[] = Array.from(propGroupMap.entries())
    .map(([propertyName, rows]) => {
      const totalImpact = Math.round(rows.reduce((s, r) => s + r.impactScore, 0) * 10) / 10;
      const avgImpact = Math.round((totalImpact / rows.length) * 10) / 10;
      const blockedCount = rows.filter(r => r.isBlocked).length;
      const tier = impactTier(avgImpact);

      // Find primary category by count
      const catCount = new Map<string, number>();
      for (const r of rows) catCount.set(r.category, (catCount.get(r.category) ?? 0) + 1);
      const primaryCategory = [...catCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "General";

      const explanation = `${propertyName} — ${rows.length} open WOs, ${blockedCount} blocked. Primary issue: ${primaryCategory}`;

      return {
        propertyId: rows[0]?.propertyId ?? null,
        propertyName,
        totalImpact,
        avgImpact,
        count: rows.length,
        blockedCount,
        rank: 0,
        primaryCategory,
        tier,
        explanation,
      };
    })
    .sort((a, b) => b.totalImpact - a.totalImpact)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  // ── Top 3 portfolio priorities ──────────────────────────────────────────────
  // Priority = (category + property) combo ranked by total impact

  const priorityMap = new Map<string, WorkOrderImpactRow[]>();
  for (const r of scored) {
    const key = `${r.category}::${r.propertyName}`;
    if (!priorityMap.has(key)) priorityMap.set(key, []);
    priorityMap.get(key)!.push(r);
  }

  const topPriorities: TopPriority[] = Array.from(priorityMap.entries())
    .map(([key, rows]) => {
      const [category, propertyName] = key.split("::");
      const totalImpact = Math.round(rows.reduce((s, r) => s + r.impactScore, 0) * 10) / 10;
      const blockedCount = rows.filter(r => r.isBlocked).length;
      const tier = impactTier(totalImpact / rows.length);

      // Generate a readable label
      const label = `${category} backlog — ${propertyName}`;

      // Generate reason
      const hasCritical = rows.some(r => r.impactTier === "critical");
      const maxDays = Math.max(...rows.map(r => computeDaysOpen({ daysInStage: r.daysInStage, createdDate: r.createdDate, status: r.status })));
      let reason: string;
      if (blockedCount > 0 && hasCritical) {
        reason = `${blockedCount} blocked with critical-priority records averaging ${maxDays}d open`;
      } else if (blockedCount > 0) {
        reason = `${blockedCount} of ${rows.length} work orders blocked, averaging ${maxDays}d open`;
      } else if (hasCritical) {
        reason = `Critical-priority records open for up to ${maxDays} days`;
      } else {
        reason = `${rows.length} open records averaging ${maxDays}d — highest impact in portfolio`;
      }

      return {
        rank: 0,
        label,
        category,
        propertyName,
        impactScore: totalImpact,
        tier,
        count: rows.length,
        blockedCount,
        reason,
        contributingIds: rows.map(r => r.id),
      };
    })
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 3)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  // ── Summary totals ──────────────────────────────────────────────────────────

  const totalImpact = Math.round(scored.reduce((s, r) => s + r.impactScore, 0) * 10) / 10;
  const avgImpact = scored.length > 0
    ? Math.round((totalImpact / scored.length) * 10) / 10
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    totalImpact,
    avgImpact,
    topPriorities,
    categoryImpact,
    propertyImpact,
    rows: scored,
    hasData: true,
  };
}
