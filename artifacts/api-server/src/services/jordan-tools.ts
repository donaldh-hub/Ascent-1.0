/**
 * Jordan's tool surface. Every tool here is read-only, and every tool that
 * returns site-level data takes `accessibleSiteIds` and filters by it —
 * the access boundary belongs on the tool itself, not on trusting the
 * model to only ask about sites it should see.
 *
 * Signal definitions (blocked, aging, SLA violation, rework, not-rent-ready)
 * reuse operational-selectors.ts exactly — never redefine a predicate here.
 * Jordan's answers must use the same definitions as the rest of the app.
 *
 * Known gap (see .agents/memory/jordan-interactive-coach.md and PR #4's
 * "explicitly not done" list): the cross-category analysis pipeline
 * (reporting-analysis-service.ts's runAllAnalysesWithRecords, and
 * rankPriorityActions built on it) has no site-scoping today. Rather than
 * silently give Jordan an unscoped priority-actions tool, or quietly
 * retrofit that whole pipeline as a side effect of this feature, this file
 * intentionally does NOT expose a priority-actions/score-target tool yet.
 * calculateImpactSnapshot() and analyzeTrends() DO take a plain records
 * array, so those are wired here on a site-filtered record pool — but
 * anything built on the unscoped AnalysisOutput pipeline is left out until
 * that pipeline itself is scoped.
 */
import { db } from "@workspace/db";
import { propertiesTable, workOrdersTable, turnsTable } from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  slaViolationsWhere,
  agingWorkOrdersWhere,
  blockedWorkOrdersWhere,
  blockedTurnsWhere,
  reworkTurnsWhere,
  notRentReadyWhere,
} from "./operational-selectors.js";
import { runAllAnalysesWithRecords } from "./reporting-analysis-service.js";
import { calculateImpactSnapshot } from "./impact-recalculation-engine.js";
import { analyzeTrends } from "./trend-pattern-analyzer.js";

const NEAR_COMPLETION_THRESHOLD_PERCENT = 80;

function siteScope(accessibleSiteIds: number[] | undefined, siteId?: number): number[] | null {
  if (siteId != null) {
    if (accessibleSiteIds && !accessibleSiteIds.includes(siteId)) return null; // not accessible
    return [siteId];
  }
  return accessibleSiteIds ?? null; // null means "no restriction" (internal/admin use only)
}

export async function listAccessibleSites(accessibleSiteIds: number[]) {
  if (accessibleSiteIds.length === 0) return { sites: [] };
  const rows = await db
    .select({ id: propertiesTable.id, name: propertiesTable.name })
    .from(propertiesTable)
    .where(inArray(propertiesTable.id, accessibleSiteIds));
  return { sites: rows };
}

export async function getWorkOrderSummary(accessibleSiteIds: number[], siteId?: number) {
  const scope = siteScope(accessibleSiteIds, siteId);
  if (scope === null) return { error: "You don't have access to that site." };
  if (scope.length === 0) return { totalOpen: 0, slaViolations: 0, agingOverSevenDays: 0, blocked: 0 };

  const propertyFilter = inArray(workOrdersTable.propertyId, scope);
  const openFilter = and(propertyFilter, eq(workOrdersTable.status, "in_progress"));

  const [openRows, slaRows, agingRows, blockedRows] = await Promise.all([
    db.select({ id: workOrdersTable.id }).from(workOrdersTable).where(openFilter),
    db.select({ id: workOrdersTable.id }).from(workOrdersTable).where(and(propertyFilter, slaViolationsWhere())),
    db.select({ id: workOrdersTable.id }).from(workOrdersTable).where(and(propertyFilter, agingWorkOrdersWhere())),
    db.select({ id: workOrdersTable.id }).from(workOrdersTable).where(and(propertyFilter, blockedWorkOrdersWhere())),
  ]);

  return {
    totalOpen: openRows.length,
    slaViolations: slaRows.length,
    agingOverSevenDays: agingRows.length,
    blocked: blockedRows.length,
  };
}

export async function getTurnSummary(accessibleSiteIds: number[], siteId?: number) {
  const scope = siteScope(accessibleSiteIds, siteId);
  if (scope === null) return { error: "You don't have access to that site." };
  if (scope.length === 0) return { total: 0, blocked: 0, rework: 0, notRentReady: 0, nearCompletion: 0 };

  const propertyFilter = inArray(turnsTable.propertyId, scope);

  const [allRows, blockedRows, reworkRows, notReadyRows, activeRows] = await Promise.all([
    db.select({ id: turnsTable.id }).from(turnsTable).where(propertyFilter),
    db.select({ id: turnsTable.id }).from(turnsTable).where(and(propertyFilter, blockedTurnsWhere())),
    db.select({ id: turnsTable.id }).from(turnsTable).where(and(propertyFilter, reworkTurnsWhere())),
    db.select({ id: turnsTable.id }).from(turnsTable).where(and(propertyFilter, notRentReadyWhere())),
    db
      .select({ id: turnsTable.id, completionPercentage: turnsTable.completionPercentage })
      .from(turnsTable)
      .where(and(propertyFilter, eq(turnsTable.turnStatus, "active"))),
  ]);

  // completionPercentage isn't part of an operational-selectors WHERE-builder
  // today, so the near-completion threshold is applied in memory here, on
  // an existing field — not a new signal definition. Stated explicitly in
  // the response so it's never a hidden magic number.
  const nearCompletionCount = activeRows.filter(
    (t) => t.completionPercentage >= NEAR_COMPLETION_THRESHOLD_PERCENT,
  ).length;

  return {
    total: allRows.length,
    active: activeRows.length,
    blocked: blockedRows.length,
    rework: reworkRows.length,
    notRentReady: notReadyRows.length,
    nearCompletion: nearCompletionCount,
    nearCompletionThresholdPercent: NEAR_COMPLETION_THRESHOLD_PERCENT,
  };
}

export async function getImpactAndTrends(accessibleSiteIds: number[], siteId?: number) {
  const scope = siteScope(accessibleSiteIds, siteId);
  if (scope === null) return { error: "You don't have access to that site." };

  const bundle = await runAllAnalysesWithRecords();
  const scoped = scope.length === 0
    ? []
    : bundle.recordPool.filter((r) => r.propertyId !== null && scope.includes(r.propertyId));

  return {
    impact: calculateImpactSnapshot(scoped),
    trends: analyzeTrends(scoped),
  };
}
