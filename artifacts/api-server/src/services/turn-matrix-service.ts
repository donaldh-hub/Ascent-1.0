/**
 * Build 1.10 — Turn Matrix Engine
 *
 * Core calculation service for turn/make-ready operations.
 * All outputs are derived from REAL input data only.
 *
 * Provides:
 *   - Stage completion % (weighted)
 *   - Blocked turn detection
 *   - Rework logic
 *   - Rent-ready status
 *   - Bottleneck aggregation (stage / property / org)
 *   - Aging analysis
 */

import { db } from "@workspace/db";
import { turnsTable, propertiesTable, unitsTable } from "@workspace/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import type { Turn } from "@workspace/db/schema";

// ─── Stage Configuration ──────────────────────────────────────────────────────

export const STAGE_SEQUENCE = [
  "Trash Out",
  "Maintenance",
  "Paint Prep",
  "Paint",
  "Flooring",
  "Cleaning",
  "Inspection",
  "Rework",
  "Completed",
] as const;

export type TurnStage = (typeof STAGE_SEQUENCE)[number];

/**
 * Cumulative completion % upon ENTERING a stage (i.e., all prior stages done).
 * Rework and Completed are handled separately.
 */
export const STAGE_ENTRY_COMPLETION: Record<string, number> = {
  "Trash Out":   0,
  "Maintenance": 12,
  "Paint Prep":  25,
  "Paint":       35,
  "Flooring":    50,
  "Cleaning":    65,
  "Inspection":  75,
  "Rework":      75, // same as Inspection entry — rework doesn't add progress
  "Completed":   100,
};

/** % contributed by each stage when fully complete */
export const STAGE_CONTRIBUTION: Record<string, number> = {
  "Trash Out":   12,
  "Maintenance": 13,
  "Paint Prep":  10,
  "Paint":       15,
  "Flooring":    15,
  "Cleaning":    10,
  "Inspection":  25,
  "Rework":      0,
  "Completed":   0,
};

/** Days-in-stage threshold before a turn is considered blocked */
export const BLOCK_THRESHOLD_DAYS = 7;

/** Aging severity thresholds (days in stage) */
export const AGING_THRESHOLDS = {
  critical: 14,
  high: 7,
  medium: 3,
  low: 0,
} as const;

export type AgingSeverity = "critical" | "high" | "medium" | "low";

// ─── Calculation Helpers ──────────────────────────────────────────────────────

export function getAgingSeverity(daysInStage: number): AgingSeverity {
  if (daysInStage >= AGING_THRESHOLDS.critical) return "critical";
  if (daysInStage >= AGING_THRESHOLDS.high) return "high";
  if (daysInStage >= AGING_THRESHOLDS.medium) return "medium";
  return "low";
}

/**
 * Calculate completion percentage from stage position.
 * Used when the CSV does not supply completion_percentage.
 */
export function calculateCompletion(currentStage: string, daysInStage: number): number {
  if (currentStage === "Completed") return 100;
  if (currentStage === "Rework") return STAGE_ENTRY_COMPLETION["Inspection"] ?? 75;

  const entry = STAGE_ENTRY_COMPLETION[currentStage] ?? 0;
  const contribution = STAGE_CONTRIBUTION[currentStage] ?? 0;

  // Partially complete the current stage based on time (assume 5 days = full stage)
  const stageProgress = Math.min(1, daysInStage / 5);
  return Math.round(entry + contribution * stageProgress);
}

/**
 * Determine rent-ready status: must be 100% complete, inspection passed,
 * no active rework.
 */
export function computeRentReady(turn: {
  completionPercentage: number;
  inspectionPassed: boolean;
  reworkRequired: boolean;
  reworkCompleted: boolean;
  turnStatus: string;
}): boolean {
  if (turn.completionPercentage < 100) return false;
  if (!turn.inspectionPassed) return false;
  if (turn.reworkRequired && !turn.reworkCompleted) return false;
  if (turn.turnStatus === "in_rework") return false;
  return true;
}

/**
 * Determine if turn is blocked: explicit flag OR days_in_stage > threshold.
 */
export function computeIsBlocked(turn: {
  isBlocked: boolean;
  daysInStage: number;
  currentStage: string | null;
  turnStatus: string;
}): boolean {
  if (turn.turnStatus === "completed") return false;
  if (turn.isBlocked) return true;
  if (turn.daysInStage > BLOCK_THRESHOLD_DAYS) return true;
  return false;
}

// ─── Per-Turn Enrichment ──────────────────────────────────────────────────────

export interface EnrichedTurn extends Turn {
  // Resolved names
  propertyName: string;
  // Calculated fields
  agingSeverity: AgingSeverity;
  isBlockedCalc: boolean;
  rentReadyCalc: boolean;
  completionCalc: number;
  stageIndex: number;
  isActive: boolean;
  isCompleted: boolean;
  isInRework: boolean;
  statusLabel: string;
  explanation: string;
}

export function enrichTurn(turn: Turn, propertyName: string): EnrichedTurn {
  const stage = turn.currentStage ?? "";
  const daysInStage = turn.daysInStage ?? 0;
  const completionCalc = turn.completionPercentage > 0
    ? turn.completionPercentage
    : calculateCompletion(stage, daysInStage);

  const isBlockedCalc = computeIsBlocked({
    isBlocked: turn.isBlocked,
    daysInStage,
    currentStage: stage,
    turnStatus: turn.turnStatus,
  });

  const rentReadyCalc = computeRentReady({
    completionPercentage: completionCalc,
    inspectionPassed: turn.inspectionPassed,
    reworkRequired: turn.reworkRequired,
    reworkCompleted: turn.reworkCompleted,
    turnStatus: turn.turnStatus,
  });

  const agingSeverity = getAgingSeverity(daysInStage);
  const stageIndex = STAGE_SEQUENCE.indexOf(stage as TurnStage);
  const isCompleted = turn.turnStatus === "completed";
  const isInRework = turn.turnStatus === "in_rework";
  const isActive = turn.turnStatus === "active";

  // Explain why it's not rent ready
  const reasons: string[] = [];
  if (completionCalc < 100) reasons.push(`${completionCalc}% complete`);
  if (!turn.inspectionPassed && !isCompleted) reasons.push("inspection pending");
  if (turn.reworkRequired && !turn.reworkCompleted) reasons.push("rework required");
  if (isBlockedCalc) reasons.push(`blocked ${daysInStage}d in ${stage}`);

  const explanation = isCompleted
    ? "Turn complete and rent ready."
    : reasons.length > 0
    ? reasons.join("; ") + "."
    : `Active — ${stage} stage.`;

  const statusLabel = isCompleted
    ? "Completed"
    : isInRework
    ? "In Rework"
    : isBlockedCalc
    ? "Blocked"
    : "Active";

  return {
    ...turn,
    propertyName,
    agingSeverity,
    isBlockedCalc,
    rentReadyCalc,
    completionCalc,
    stageIndex,
    isActive,
    isCompleted,
    isInRework,
    statusLabel,
    explanation,
  };
}

// ─── Bottleneck Aggregation ───────────────────────────────────────────────────

export interface StageBottleneckRow {
  stage: string;
  turnCount: number;
  blockedCount: number;
  avgDaysInStage: number;
  agingSeverity: AgingSeverity;
}

export interface BottleneckAnalysis {
  primaryStage: string;
  severityScore: number;
  explanation: string;
  stageBreakdown: StageBottleneckRow[];
}

export function buildBottleneckAnalysis(turns: EnrichedTurn[]): BottleneckAnalysis | null {
  const activeTurns = turns.filter(t => !t.isCompleted);
  if (activeTurns.length === 0) return null;

  const stageMap = new Map<string, { count: number; blocked: number; totalDays: number }>();

  for (const t of activeTurns) {
    const stage = t.currentStage ?? "Unknown";
    if (!stageMap.has(stage)) stageMap.set(stage, { count: 0, blocked: 0, totalDays: 0 });
    const row = stageMap.get(stage)!;
    row.count++;
    if (t.isBlockedCalc) row.blocked++;
    row.totalDays += t.daysInStage ?? 0;
  }

  const breakdown: StageBottleneckRow[] = Array.from(stageMap.entries())
    .map(([stage, data]) => ({
      stage,
      turnCount: data.count,
      blockedCount: data.blocked,
      avgDaysInStage: data.count > 0 ? Math.round(data.totalDays / data.count) : 0,
      agingSeverity: getAgingSeverity(data.count > 0 ? data.totalDays / data.count : 0),
    }))
    .sort((a, b) => {
      // Score: heavily weight blocked count + avg aging
      const scoreA = a.blockedCount * 3 + a.avgDaysInStage + a.turnCount;
      const scoreB = b.blockedCount * 3 + b.avgDaysInStage + b.turnCount;
      return scoreB - scoreA;
    });

  if (breakdown.length === 0) return null;

  const primary = breakdown[0]!;
  const severityScore = Math.min(100, Math.round(
    (primary.blockedCount / Math.max(1, activeTurns.length)) * 60 +
    (primary.avgDaysInStage / AGING_THRESHOLDS.critical) * 40
  ));

  const parts: string[] = [];
  if (primary.blockedCount > 0) parts.push(`${primary.blockedCount} blocked`);
  if (primary.avgDaysInStage > 3) parts.push(`avg ${primary.avgDaysInStage}d aging`);
  if (primary.turnCount > 1) parts.push(`${primary.turnCount} turns congested`);

  const explanation = `${primary.stage} is the primary bottleneck — ${parts.join(", ")}.`;

  return { primaryStage: primary.stage, severityScore, explanation, stageBreakdown: breakdown };
}

// ─── Property Aggregation ─────────────────────────────────────────────────────

export interface PropertyTurnSummary {
  propertyId: number | null;
  propertyName: string;
  totalTurns: number;
  activeTurns: number;
  completedTurns: number;
  blockedTurns: number;
  reworkTurns: number;
  notRentReady: number;
  avgCompletion: number;
  primaryBottleneckStage: string | null;
  performanceScore: number;
  explanation: string;
}

export function buildPropertySummaries(turns: EnrichedTurn[]): PropertyTurnSummary[] {
  const propMap = new Map<string, EnrichedTurn[]>();
  for (const t of turns) {
    const key = t.propertyName;
    if (!propMap.has(key)) propMap.set(key, []);
    propMap.get(key)!.push(t);
  }

  return Array.from(propMap.entries()).map(([propertyName, propTurns]) => {
    const active = propTurns.filter(t => t.isActive);
    const completed = propTurns.filter(t => t.isCompleted);
    const blocked = propTurns.filter(t => t.isBlockedCalc);
    const rework = propTurns.filter(t => t.isInRework);
    const notRentReady = propTurns.filter(t => !t.rentReadyCalc);

    const activePct = active.map(t => t.completionCalc);
    const avgCompletion = activePct.length > 0
      ? Math.round(activePct.reduce((a, b) => a + b, 0) / activePct.length)
      : (completed.length > 0 ? 100 : 0);

    // Performance score: penalize blocked/rework, reward completion
    const base = avgCompletion;
    const blockedPenalty = (blocked.length / Math.max(1, propTurns.length)) * 30;
    const reworkPenalty = (rework.length / Math.max(1, propTurns.length)) * 20;
    const performanceScore = Math.max(0, Math.round(base - blockedPenalty - reworkPenalty));

    const bottleneck = buildBottleneckAnalysis(turns.filter(t => t.propertyName === propertyName));

    const issues: string[] = [];
    if (blocked.length > 0) issues.push(`${blocked.length} blocked`);
    if (rework.length > 0) issues.push(`${rework.length} in rework`);
    const explanation = issues.length > 0
      ? `${issues.join(", ")} across ${propTurns.length} turns.`
      : completed.length === propTurns.length
      ? "All turns complete."
      : `${active.length} turns in progress.`;

    return {
      propertyId: propTurns[0]?.propertyId ?? null,
      propertyName,
      totalTurns: propTurns.length,
      activeTurns: active.length,
      completedTurns: completed.length,
      blockedTurns: blocked.length,
      reworkTurns: rework.length,
      notRentReady: notRentReady.length,
      avgCompletion,
      primaryBottleneckStage: bottleneck?.primaryStage ?? null,
      performanceScore,
      explanation,
    };
  }).sort((a, b) => a.performanceScore - b.performanceScore); // worst-performing first
}

// ─── Full Turn Matrix ─────────────────────────────────────────────────────────

export interface TurnMatrixResult {
  hasData: boolean;
  totalTurns: number;
  activeTurns: number;
  completedTurns: number;
  reworkTurns: number;
  blockedTurns: number;
  notRentReadyCount: number;
  avgCompletionPct: number;
  bottleneck: BottleneckAnalysis | null;
  propertySummaries: PropertyTurnSummary[];
  stageCongestion: StageBottleneckRow[];
  turns: EnrichedTurn[];
  dataQuality: string;
}

export async function buildTurnMatrix(): Promise<TurnMatrixResult> {
  const rawTurns = await db
    .select()
    .from(turnsTable)
    .orderBy(turnsTable.id);

  if (rawTurns.length === 0) {
    return {
      hasData: false,
      totalTurns: 0,
      activeTurns: 0,
      completedTurns: 0,
      reworkTurns: 0,
      blockedTurns: 0,
      notRentReadyCount: 0,
      avgCompletionPct: 0,
      bottleneck: null,
      propertySummaries: [],
      stageCongestion: [],
      turns: [],
      dataQuality: "No turn data available — metrics are provisional.",
    };
  }

  // Resolve property names
  const propertyIds = [...new Set(rawTurns.map(t => t.propertyId).filter(Boolean))] as number[];
  const propertyRows = propertyIds.length > 0
    ? await db.select().from(propertiesTable).where(inArray(propertiesTable.id, propertyIds))
    : [];
  const propertyNameMap = new Map<number, string>(
    propertyRows.map(p => [p.id, p.name])
  );

  // Enrich all turns
  const enriched: EnrichedTurn[] = rawTurns.map(t => {
    const propertyName = (t.propertyId && propertyNameMap.get(t.propertyId))
      ?? t.propertyNameRaw
      ?? "Unknown Property";
    return enrichTurn(t, propertyName);
  });

  const active = enriched.filter(t => t.isActive);
  const completed = enriched.filter(t => t.isCompleted);
  const rework = enriched.filter(t => t.isInRework);
  const blocked = enriched.filter(t => t.isBlockedCalc);
  const notRentReady = enriched.filter(t => !t.rentReadyCalc);

  const activePcts = active.concat(rework).map(t => t.completionCalc);
  const avgCompletionPct = activePcts.length > 0
    ? Math.round(activePcts.reduce((a, b) => a + b, 0) / activePcts.length)
    : (completed.length > 0 ? 100 : 0);

  const bottleneck = buildBottleneckAnalysis(enriched);
  const propertySummaries = buildPropertySummaries(enriched);

  let dataQuality: string;
  if (rawTurns.length < 5) {
    dataQuality = `Limited turn data available (${rawTurns.length} turns) — metrics are provisional.`;
  } else if (completed.length === 0) {
    dataQuality = "No completed turns yet — execution score not stable.";
  } else {
    dataQuality = `${rawTurns.length} turns loaded. ${completed.length} completed, ${active.length + rework.length} in progress.`;
  }

  return {
    hasData: true,
    totalTurns: rawTurns.length,
    activeTurns: active.length,
    completedTurns: completed.length,
    reworkTurns: rework.length,
    blockedTurns: blocked.length,
    notRentReadyCount: notRentReady.length,
    avgCompletionPct,
    bottleneck,
    propertySummaries,
    stageCongestion: bottleneck?.stageBreakdown ?? [],
    turns: enriched,
    dataQuality,
  };
}

// ─── Aggregate Stats (lightweight, for dashboard) ─────────────────────────────

export interface TurnStats {
  totalTurns: number;
  activeTurns: number;
  completedTurns: number;
  blockedTurns: number;
  reworkTurns: number;
  notRentReadyCount: number;
  avgCompletionPct: number;
  primaryBottleneckStage: string | null;
  bottleneckSeverity: number;
  bottleneckExplanation: string | null;
  propertyCount: number;
  hasData: boolean;
  dataQuality: string;
}

export async function getTurnStats(): Promise<TurnStats> {
  const matrix = await buildTurnMatrix();
  return {
    totalTurns: matrix.totalTurns,
    activeTurns: matrix.activeTurns,
    completedTurns: matrix.completedTurns,
    blockedTurns: matrix.blockedTurns,
    reworkTurns: matrix.reworkTurns,
    notRentReadyCount: matrix.notRentReadyCount,
    avgCompletionPct: matrix.avgCompletionPct,
    primaryBottleneckStage: matrix.bottleneck?.primaryStage ?? null,
    bottleneckSeverity: matrix.bottleneck?.severityScore ?? 0,
    bottleneckExplanation: matrix.bottleneck?.explanation ?? null,
    propertyCount: matrix.propertySummaries.length,
    hasData: matrix.hasData,
    dataQuality: matrix.dataQuality,
  };
}

export async function getTurnStatsByProperty(propertyId: number): Promise<TurnStats> {
  const rawTurns = await db
    .select()
    .from(turnsTable)
    .where(eq(turnsTable.propertyId, propertyId));

  if (rawTurns.length === 0) {
    return {
      totalTurns: 0, activeTurns: 0, completedTurns: 0,
      blockedTurns: 0, reworkTurns: 0, notRentReadyCount: 0,
      avgCompletionPct: 0, primaryBottleneckStage: null,
      bottleneckSeverity: 0, bottleneckExplanation: null,
      propertyCount: 0, hasData: false,
      dataQuality: "No turn data imported for this property yet.",
    };
  }

  const [prop] = await db
    .select({ name: propertiesTable.name })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId))
    .limit(1);
  const propertyName = prop?.name ?? "Unknown";

  const enriched = rawTurns.map(t => enrichTurn(t, propertyName));
  const active = enriched.filter(t => t.isActive);
  const completed = enriched.filter(t => t.isCompleted);
  const rework = enriched.filter(t => t.isInRework);
  const blocked = enriched.filter(t => t.isBlockedCalc);
  const notRentReady = enriched.filter(t => !t.rentReadyCalc && !t.isCompleted);
  const avgCompletionPct = enriched.length > 0
    ? Math.round(enriched.reduce((s, t) => s + t.completionCalc, 0) / enriched.length)
    : 0;

  const bottleneck = buildBottleneckAnalysis(enriched);

  return {
    totalTurns: rawTurns.length,
    activeTurns: active.length,
    completedTurns: completed.length,
    blockedTurns: blocked.length,
    reworkTurns: rework.length,
    notRentReadyCount: notRentReady.length,
    avgCompletionPct,
    primaryBottleneckStage: bottleneck?.primaryStage ?? null,
    bottleneckSeverity: bottleneck?.severityScore ?? 0,
    bottleneckExplanation: bottleneck?.explanation ?? null,
    propertyCount: 1,
    hasData: true,
    dataQuality: `${rawTurns.length} turns at this property — ${completed.length} completed, ${active.length + rework.length} in progress.`,
  };
}

// ─── Property Fuzzy Matching (reused from work-order-service pattern) ─────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

export async function resolvePropertyForTurn(
  nameRaw: string,
  cache: Map<string, number | null>
): Promise<number | null> {
  const key = nameRaw.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key)!;

  const all = await db.select({ id: propertiesTable.id, name: propertiesTable.name }).from(propertiesTable);

  // 1. Exact match (case-insensitive)
  const exact = all.find(p => p.name.toLowerCase() === key);
  if (exact) { cache.set(key, exact.id); return exact.id; }

  // 2. Contains match
  const contains = all.find(p =>
    p.name.toLowerCase().includes(key) || key.includes(p.name.toLowerCase())
  );
  if (contains) { cache.set(key, contains.id); return contains.id; }

  // 3. Levenshtein fuzzy (within 4 edits)
  const fuzzy = all
    .map(p => ({ id: p.id, dist: levenshtein(key, p.name.toLowerCase()) }))
    .sort((a, b) => a.dist - b.dist)[0];
  if (fuzzy && fuzzy.dist <= 4) { cache.set(key, fuzzy.id); return fuzzy.id; }

  // 4. Auto-create
  const [newProp] = await db
    .insert(propertiesTable)
    .values({ name: nameRaw.trim() })
    .returning({ id: propertiesTable.id });
  const newId = newProp?.id ?? null;
  cache.set(key, newId);
  return newId;
}

export async function resolveUnitForTurn(
  unitNumber: string,
  propertyId: number | null,
  cache: Map<string, number | null>
): Promise<number | null> {
  if (!propertyId || !unitNumber) return null;
  const key = `${propertyId}:${unitNumber}`;
  if (cache.has(key)) return cache.get(key)!;

  const normalized = unitNumber.replace(/\D+/g, "");
  const units = await db.select().from(unitsTable).where(eq(unitsTable.propertyId, propertyId));
  const match = units.find(u =>
    u.unitNumber === unitNumber ||
    u.unitNumber.replace(/\D+/g, "") === normalized
  );

  if (match) { cache.set(key, match.id); return match.id; }

  // Auto-create unit
  const [newUnit] = await db
    .insert(unitsTable)
    .values({ propertyId, unitNumber: unitNumber.trim() })
    .returning({ id: unitsTable.id });
  const newId = newUnit?.id ?? null;
  cache.set(key, newId);
  return newId;
}
