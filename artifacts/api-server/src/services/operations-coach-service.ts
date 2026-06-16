import { db } from "@workspace/db";
import { workOrdersTable, assetsTable, propertiesTable } from "@workspace/db/schema";
import { sql, isNotNull, gte, isNull } from "drizzle-orm";

export interface CoachInsight {
  insightId: string;
  category: "maintenance" | "compliance" | "efficiency" | "cost" | "staffing";
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  finding: string;
  recommendation: string;
  impactEstimate: string;
  evidenceSummary: string;
  propertyName?: string;
}

export interface CoachReport {
  generatedAt: string;
  coachUnlocked: boolean;
  workOrderCount: number;
  unlockThreshold: number;
  insights: CoachInsight[];
  topPriority: CoachInsight | null;
  summary: string;
  confidenceNote: string;
}

const UNLOCK_THRESHOLD = 50;

export async function generateCoachRecommendations(): Promise<CoachReport> {
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [totalCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workOrdersTable);

  const workOrderCount = totalCountRow?.count ?? 0;

  if (workOrderCount < UNLOCK_THRESHOLD) {
    return {
      generatedAt: now.toISOString(),
      coachUnlocked: false,
      workOrderCount,
      unlockThreshold: UNLOCK_THRESHOLD,
      insights: [],
      topPriority: null,
      summary: `Operations Coach unlocks after ${UNLOCK_THRESHOLD} work orders. You have ${workOrderCount} so far — upload more data to activate AI-powered recommendations.`,
      confidenceNote: "Insufficient data for pattern analysis.",
    };
  }

  const insights: CoachInsight[] = [];

  // ── Insight 1: Repeat-issue assets ────────────────────────────────────────
  const repeatAssets = await db
    .select({
      assetId: workOrdersTable.assetId,
      assetName: assetsTable.name,
      assetType: assetsTable.assetType,
      propertyName: propertiesTable.name,
      count: sql<number>`count(*)::int`,
    })
    .from(workOrdersTable)
    .leftJoin(assetsTable, sql`${workOrdersTable.assetId} = ${assetsTable.id}`)
    .leftJoin(propertiesTable, sql`${assetsTable.propertyId} = ${propertiesTable.id}`)
    .where(isNotNull(workOrdersTable.assetId))
    .groupBy(workOrdersTable.assetId, assetsTable.name, assetsTable.assetType, propertiesTable.name)
    .having(sql`count(*) >= 3`)
    .orderBy(sql`count(*) desc`)
    .limit(5);

  if (repeatAssets.length > 0) {
    const top = repeatAssets[0];
    const topName = top.assetName ?? `Asset #${top.assetId}`;
    const topType = top.assetType ?? "asset";
    const topCount = top.count;
    insights.push({
      insightId: "repeat_issues_top_asset",
      category: "maintenance",
      priority: topCount >= 5 ? "critical" : "high",
      title: "High-frequency repeat issues detected",
      finding: `${topName} (${topType}) has ${topCount} work orders — the highest repeat-issue rate in your portfolio.`,
      recommendation: `Schedule a full inspection of ${topName}. Consider replacement or a preventive maintenance contract if the pattern continues.`,
      impactEstimate: "Could reduce repeat WOs by ~30–40% for this asset.",
      evidenceSummary: `Based on ${topCount} WOs linked to ${topName}. ${repeatAssets.length} assets total with 3+ WOs.`,
      propertyName: top.propertyName ?? undefined,
    });
  }

  // ── Insight 2: High % open/pending WOs ────────────────────────────────────
  const [openCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workOrdersTable)
    .where(sql`${workOrdersTable.status} in ('submitted', 'assigned', 'in_progress')`);

  const openCount = openCountRow?.count ?? 0;
  const openPct = workOrderCount > 0 ? Math.round((openCount / workOrderCount) * 100) : 0;

  if (openPct >= 30) {
    insights.push({
      insightId: "high_open_wo_rate",
      category: "efficiency",
      priority: openPct >= 50 ? "critical" : "high",
      title: "High proportion of open work orders",
      finding: `${openPct}% of all work orders (${openCount} of ${workOrderCount}) are currently open or in progress.`,
      recommendation: "Review oldest open work orders for blockers. Set weekly closure targets and assign ownership for overdue items.",
      impactEstimate: "Closing stale WOs could improve SLA compliance metrics significantly.",
      evidenceSummary: `${openCount} WOs with status submitted/assigned/in_progress out of ${workOrderCount} total.`,
    });
  }

  // ── Insight 3: Critical priority volume ───────────────────────────────────
  const [criticalCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workOrdersTable)
    .where(sql`${workOrdersTable.priority} = 'critical'`);

  const criticalCount = criticalCountRow?.count ?? 0;
  const criticalPct = workOrderCount > 0 ? Math.round((criticalCount / workOrderCount) * 100) : 0;

  if (criticalPct >= 20 || criticalCount >= 10) {
    insights.push({
      insightId: "high_critical_volume",
      category: "staffing",
      priority: criticalPct >= 30 ? "critical" : "high",
      title: "Elevated critical-priority work order volume",
      finding: `${criticalCount} work orders (${criticalPct}% of total) are marked critical priority.`,
      recommendation: "Audit critical-priority tagging to ensure consistent standards. If tagging is accurate, consider adding staff capacity or escalation protocols.",
      impactEstimate: "Proper prioritization could reduce response time for genuine emergencies by ~25%.",
      evidenceSummary: `${criticalCount} WOs tagged critical out of ${workOrderCount} total.`,
    });
  }

  // ── Insight 4: WOs missing evidence on closed items ───────────────────────
  const [closedNoNotesRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workOrdersTable)
    .where(sql`${workOrdersTable.status} = 'completed' and (${workOrdersTable.notes} is null or ${workOrdersTable.notes} = '')`);

  const closedNoNotes = closedNoNotesRow?.count ?? 0;

  if (closedNoNotes >= 5) {
    insights.push({
      insightId: "missing_closure_evidence",
      category: "compliance",
      priority: closedNoNotes >= 20 ? "high" : "medium",
      title: "Closed work orders missing resolution notes",
      finding: `${closedNoNotes} completed work orders have no notes or resolution documentation.`,
      recommendation: "Require technicians to add resolution notes before marking WOs complete. Consider adding a mandatory notes field in your workflow.",
      impactEstimate: "Proper documentation reduces re-work and supports compliance audits.",
      evidenceSummary: `${closedNoNotes} completed WOs with empty notes field.`,
    });
  }

  // ── Insight 5: Properties with disproportionate WO volume ─────────────────
  const propVolumes = await db
    .select({
      propertyId: workOrdersTable.propertyId,
      propertyName: propertiesTable.name,
      count: sql<number>`count(*)::int`,
    })
    .from(workOrdersTable)
    .leftJoin(propertiesTable, sql`${workOrdersTable.propertyId} = ${propertiesTable.id}`)
    .where(isNotNull(workOrdersTable.propertyId))
    .groupBy(workOrdersTable.propertyId, propertiesTable.name)
    .orderBy(sql`count(*) desc`)
    .limit(10);

  if (propVolumes.length >= 2) {
    const topVol = propVolumes[0];
    const avgVol = propVolumes.reduce((s, r) => s + r.count, 0) / propVolumes.length;
    if (topVol.count > avgVol * 2) {
      insights.push({
        insightId: "property_concentration",
        category: "cost",
        priority: "medium",
        title: "High work order concentration at one property",
        finding: `${topVol.propertyName ?? `Property #${topVol.propertyId}`} accounts for ${topVol.count} work orders — ${Math.round(topVol.count / avgVol)}x the portfolio average of ${Math.round(avgVol)}.`,
        recommendation: "Investigate root causes at this property. Consider a focused maintenance audit or capital planning review.",
        impactEstimate: "Addressing root causes could reduce per-unit maintenance costs by 15–25%.",
        evidenceSummary: `Top property has ${topVol.count} WOs vs. portfolio average of ${Math.round(avgVol)} across ${propVolumes.length} properties.`,
        propertyName: topVol.propertyName ?? undefined,
      });
    }
  }

  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  insights.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const topInsights = insights.slice(0, 5);
  const topPriority = topInsights[0] ?? null;

  const summary =
    topInsights.length === 0
      ? "No significant operational patterns detected. Keep uploading data for more targeted insights."
      : `Operations Coach found ${topInsights.length} insight${topInsights.length > 1 ? "s" : ""} based on your work order data. ${topPriority ? `Top priority: ${topPriority.title}.` : ""}`;

  return {
    generatedAt: now.toISOString(),
    coachUnlocked: true,
    workOrderCount,
    unlockThreshold: UNLOCK_THRESHOLD,
    insights: topInsights,
    topPriority,
    summary,
    confidenceNote: `Analysis based on ${workOrderCount} work orders. Recommendations improve accuracy with more data and consistent categorization.`,
  };
}
