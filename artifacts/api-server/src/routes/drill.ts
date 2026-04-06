/**
 * /api/drill — Signal-to-Query Engine
 *
 * Receives a signal_type + optional scope params and returns a structured
 * result set of real records that explain / prove the signal.
 *
 * Signal types:
 *   expired_warranty  — assets whose warranty has expired
 *   expiring_soon     — assets whose warranty expires within 90 days
 *   critical_items    — active alerts with level=critical
 *   overdue_items     — active alerts with category=timing_alert (overdue)
 *   bottleneck_items  — workflow items stuck in bottleneck stages
 *   stale_items       — workflow items with no movement for 7+ days
 *   at_risk_workflows — workflows with red stoplight or at_risk status
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  assetsTable,
  unitsTable,
  propertiesTable,
  alertsTable,
  workflowItemsTable,
  stagesTable,
  workflowsTable,
} from "@workspace/db/schema";
import { eq, and, lt, ne, inArray, or } from "drizzle-orm";

const router = Router();

// ─── Types ────────────────────────────────────────────────────────────────────

type DrillRowType = "asset" | "alert" | "item" | "workflow";
type BadgeColor = "red" | "yellow" | "green" | "blue";

interface DrillRow {
  id: number;
  rowType: DrillRowType;
  title: string;
  subtitle: string;
  detail: string;
  badge?: string;
  badgeColor?: BadgeColor;
  navigateTo?: string;
  meta: Record<string, unknown>;
}

interface DrillResponse {
  signal: string;
  title: string;
  total: number;
  triggerExplanation: string;
  rows: DrillRow[];
}

// ─── Signal metadata ──────────────────────────────────────────────────────────

const SIGNAL_META: Record<string, { title: string; triggerExplanation: string }> = {
  expired_warranty: {
    title: "Expired Warranties",
    triggerExplanation:
      "Assets listed here have expired warranties, increasing financial exposure and uncoverable repair costs. Each expired warranty is a gap in liability coverage.",
  },
  expiring_soon: {
    title: "Warranties Expiring Soon",
    triggerExplanation:
      "These assets have warranties expiring within 90 days. Plan replacements or renewals before coverage lapses to avoid unprotected risk.",
  },
  critical_items: {
    title: "Critical Priority Items",
    triggerExplanation:
      "These active alerts are flagged as critical priority and require immediate attention. Unresolved critical items elevate the overall risk score.",
  },
  overdue_items: {
    title: "Overdue Items",
    triggerExplanation:
      "These items have passed their due date. Each day of delay increases risk exposure and contributes to execution score degradation.",
  },
  bottleneck_items: {
    title: "Bottleneck Stage Items",
    triggerExplanation:
      "These items are stuck in identified bottleneck stages, slowing the overall workflow and suppressing the flow score.",
  },
  stale_items: {
    title: "Stale / Aging Items",
    triggerExplanation:
      "These items have been in their current stage for 7+ days with no movement. Stale items are a leading indicator of systemic slowdown.",
  },
  at_risk_workflows: {
    title: "At-Risk Workflows",
    triggerExplanation:
      "These workflows have a red stoplight status or are marked at_risk, indicating critical health degradation requiring intervention.",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function ninetyDaysLaterStr(): string {
  return new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
}

function daysDiff(dateStr: string): number {
  return Math.round((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function daysUntil(dateStr: string): number {
  return Math.round((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function daysInStageFromTs(ts: Date): number {
  return Math.round((Date.now() - new Date(ts).getTime()) / 86400000);
}

// ─── Drill functions ──────────────────────────────────────────────────────────

async function assetWarrantyDrill(signal: string, propertyId?: number): Promise<DrillRow[]> {
  const today = todayStr();
  const ninety = ninetyDaysLaterStr();

  const allAssets = await db
    .select({
      id: assetsTable.id,
      name: assetsTable.name,
      assetType: assetsTable.assetType,
      status: assetsTable.status,
      installDate: assetsTable.installDate,
      warrantyStart: assetsTable.warrantyStart,
      warrantyExpiration: assetsTable.warrantyExpiration,
      unitId: assetsTable.unitId,
      propertyId: assetsTable.propertyId,
      unitNumber: unitsTable.unitNumber,
      propertyName: propertiesTable.name,
    })
    .from(assetsTable)
    .leftJoin(unitsTable, eq(assetsTable.unitId, unitsTable.id))
    .leftJoin(propertiesTable, eq(assetsTable.propertyId, propertiesTable.id));

  let filtered = allAssets;
  if (propertyId) {
    filtered = filtered.filter((a) => a.propertyId === propertyId);
  }

  if (signal === "expired_warranty") {
    filtered = filtered.filter((a) => a.warrantyExpiration != null && a.warrantyExpiration < today);
  } else {
    filtered = filtered.filter(
      (a) => a.warrantyExpiration != null && a.warrantyExpiration >= today && a.warrantyExpiration <= ninety,
    );
  }

  return filtered.map((a) => {
    const isExpired = signal === "expired_warranty";
    const unitLabel = a.unitNumber ? `Unit ${a.unitNumber}` : "No unit";
    const propertyLabel = a.propertyName ?? "Unknown property";
    const dAgo = a.warrantyExpiration ? daysDiff(a.warrantyExpiration) : null;
    const dLeft = a.warrantyExpiration ? daysUntil(a.warrantyExpiration) : null;

    return {
      id: a.id,
      rowType: "asset" as DrillRowType,
      title: a.name + (a.assetType ? ` (${a.assetType})` : ""),
      subtitle: `${unitLabel} · ${propertyLabel}`,
      detail: isExpired
        ? `Expired: ${a.warrantyExpiration ?? "unknown"}${dAgo !== null && dAgo >= 0 ? ` · ${dAgo}d ago` : ""}`
        : `Expires: ${a.warrantyExpiration}${dLeft !== null ? ` · in ${dLeft}d` : ""}`,
      badge: isExpired ? "EXPIRED" : "EXPIRING",
      badgeColor: isExpired ? ("red" as BadgeColor) : ("yellow" as BadgeColor),
      navigateTo: a.unitId ? `/units/${a.unitId}` : undefined,
      meta: {
        assetType: a.assetType,
        installDate: a.installDate,
        warrantyStart: a.warrantyStart,
        warrantyExpiration: a.warrantyExpiration,
        unitId: a.unitId,
        propertyId: a.propertyId,
      },
    };
  });
}

async function criticalItemsDrill(): Promise<DrillRow[]> {
  const alerts = await db
    .select()
    .from(alertsTable)
    .where(and(eq(alertsTable.level, "critical"), eq(alertsTable.status, "active")));

  const wfIds = [...new Set(alerts.filter((a) => a.workflowId).map((a) => a.workflowId as number))];
  const workflows =
    wfIds.length > 0
      ? await db
          .select({ id: workflowsTable.id, title: workflowsTable.title })
          .from(workflowsTable)
          .where(inArray(workflowsTable.id, wfIds))
      : [];
  const wfMap = new Map(workflows.map((w) => [w.id, w.title]));

  return alerts.map((a) => ({
    id: a.id,
    rowType: "alert" as DrillRowType,
    title: a.title,
    subtitle: a.workflowId
      ? `Workflow: ${wfMap.get(a.workflowId) ?? "Unknown"}`
      : a.category.replace(/_/g, " "),
    detail: a.message.slice(0, 120),
    badge: "CRITICAL",
    badgeColor: "red" as BadgeColor,
    navigateTo: a.workflowId ? `/workflows/${a.workflowId}` : "/alerts",
    meta: { category: a.category, workflowId: a.workflowId, ruleKey: a.ruleKey },
  }));
}

async function overdueItemsDrill(): Promise<DrillRow[]> {
  const alerts = await db
    .select()
    .from(alertsTable)
    .where(and(eq(alertsTable.category, "timing_alert"), eq(alertsTable.status, "active")));

  const wfIds = [...new Set(alerts.filter((a) => a.workflowId).map((a) => a.workflowId as number))];
  const workflows =
    wfIds.length > 0
      ? await db
          .select({ id: workflowsTable.id, title: workflowsTable.title })
          .from(workflowsTable)
          .where(inArray(workflowsTable.id, wfIds))
      : [];
  const wfMap = new Map(workflows.map((w) => [w.id, w.title]));

  return alerts.map((a) => ({
    id: a.id,
    rowType: "alert" as DrillRowType,
    title: a.title,
    subtitle: a.workflowId ? `Workflow: ${wfMap.get(a.workflowId) ?? "Unknown"}` : "Timing Alert",
    detail: a.message.slice(0, 120),
    badge: "OVERDUE",
    badgeColor: "yellow" as BadgeColor,
    navigateTo: a.workflowId ? `/workflows/${a.workflowId}` : "/alerts",
    meta: { category: a.category, workflowId: a.workflowId },
  }));
}

async function bottleneckItemsDrill(workflowId?: number, stageId?: number): Promise<DrillRow[]> {
  if (workflowId && stageId) {
    const items = await db
      .select()
      .from(workflowItemsTable)
      .where(
        and(
          eq(workflowItemsTable.workflowId, workflowId),
          eq(workflowItemsTable.stageId, stageId),
          ne(workflowItemsTable.status, "completed"),
        ),
      );

    const [stage] = await db.select().from(stagesTable).where(eq(stagesTable.id, stageId));
    const [workflow] = await db.select().from(workflowsTable).where(eq(workflowsTable.id, workflowId));

    return items.map((item) => {
      const days = daysInStageFromTs(item.stageEnteredAt);
      return {
        id: item.id,
        rowType: "item" as DrillRowType,
        title: item.title,
        subtitle: `${stage?.name ?? "Stage"} · ${workflow?.title ?? "Workflow"}`,
        detail: `${days}d in stage · ${item.priority} priority · ${item.status}`,
        badge: item.priority === "critical" ? "CRITICAL" : days > 14 ? "AGING" : "STUCK",
        badgeColor:
          item.priority === "critical" ? ("red" as BadgeColor) : days > 14 ? ("red" as BadgeColor) : ("yellow" as BadgeColor),
        navigateTo: `/workflows/${workflowId}`,
        meta: { priority: item.priority, status: item.status, days, stageId, workflowId },
      };
    });
  }

  const bottleneckStages = await db
    .select()
    .from(stagesTable)
    .where(eq(stagesTable.isBottleneck, true));

  if (bottleneckStages.length === 0) return [];

  const stageIds = bottleneckStages.map((s) => s.id);
  const items = await db
    .select()
    .from(workflowItemsTable)
    .where(and(inArray(workflowItemsTable.stageId, stageIds), ne(workflowItemsTable.status, "completed")));

  const stageMap = new Map(bottleneckStages.map((s) => [s.id, s]));
  const wfIds = [...new Set(items.map((i) => i.workflowId))];
  const workflows =
    wfIds.length > 0
      ? await db
          .select({ id: workflowsTable.id, title: workflowsTable.title })
          .from(workflowsTable)
          .where(inArray(workflowsTable.id, wfIds))
      : [];
  const wfMap = new Map(workflows.map((w) => [w.id, w.title]));

  return items.map((item) => {
    const stage = stageMap.get(item.stageId);
    const days = daysInStageFromTs(item.stageEnteredAt);
    return {
      id: item.id,
      rowType: "item" as DrillRowType,
      title: item.title,
      subtitle: `${stage?.name ?? "Stage"} · ${wfMap.get(item.workflowId) ?? "Workflow"}`,
      detail: `${days}d in stage · ${item.priority} priority · ${item.status}`,
      badge: item.priority === "critical" ? "CRITICAL" : days > 14 ? "AGING" : "STUCK",
      badgeColor:
        item.priority === "critical" ? ("red" as BadgeColor) : days > 14 ? ("red" as BadgeColor) : ("yellow" as BadgeColor),
      navigateTo: `/workflows/${item.workflowId}`,
      meta: { priority: item.priority, status: item.status, days, stageId: item.stageId, workflowId: item.workflowId },
    };
  });
}

async function staleItemsDrill(workflowId?: number): Promise<DrillRow[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const conditions = workflowId
    ? and(
        eq(workflowItemsTable.workflowId, workflowId),
        ne(workflowItemsTable.status, "completed"),
        lt(workflowItemsTable.stageEnteredAt, sevenDaysAgo),
      )
    : and(
        ne(workflowItemsTable.status, "completed"),
        lt(workflowItemsTable.stageEnteredAt, sevenDaysAgo),
      );

  const items = await db.select().from(workflowItemsTable).where(conditions);

  const stageIds = [...new Set(items.map((i) => i.stageId))];
  const wfIds = [...new Set(items.map((i) => i.workflowId))];

  const [stages, workflows] = await Promise.all([
    stageIds.length > 0
      ? db.select().from(stagesTable).where(inArray(stagesTable.id, stageIds))
      : Promise.resolve([]),
    wfIds.length > 0
      ? db
          .select({ id: workflowsTable.id, title: workflowsTable.title })
          .from(workflowsTable)
          .where(inArray(workflowsTable.id, wfIds))
      : Promise.resolve([]),
  ]);

  const stageMap = new Map(stages.map((s) => [s.id, s]));
  const wfMap = new Map(workflows.map((w) => [w.id, w.title]));

  return items.map((item) => {
    const stage = stageMap.get(item.stageId);
    const days = daysInStageFromTs(item.stageEnteredAt);
    return {
      id: item.id,
      rowType: "item" as DrillRowType,
      title: item.title,
      subtitle: `${stage?.name ?? "Stage"} · ${wfMap.get(item.workflowId) ?? "Workflow"}`,
      detail: `${days}d in stage · ${item.priority} priority`,
      badge: days > 14 ? "AGING" : "STALE",
      badgeColor: days > 14 ? ("red" as BadgeColor) : ("yellow" as BadgeColor),
      navigateTo: `/workflows/${item.workflowId}`,
      meta: { priority: item.priority, status: item.status, days, stageId: item.stageId, workflowId: item.workflowId },
    };
  });
}

async function atRiskWorkflowsDrill(): Promise<DrillRow[]> {
  const workflows = await db
    .select()
    .from(workflowsTable)
    .where(or(eq(workflowsTable.stoplight, "red"), eq(workflowsTable.status, "at_risk")));

  return workflows.map((wf) => ({
    id: wf.id,
    rowType: "workflow" as DrillRowType,
    title: wf.title,
    subtitle: `Health: ${Math.round(wf.healthScore)}/100 · Status: ${wf.status.replace("_", " ")}`,
    detail: `Flow: ${Math.round(wf.flowScore)} · Risk: ${Math.round(wf.riskScore)} · Execution: ${Math.round(wf.executionScore)}`,
    badge: wf.stoplight === "red" ? "AT RISK" : "WARNING",
    badgeColor: wf.stoplight === "red" ? ("red" as BadgeColor) : ("yellow" as BadgeColor),
    navigateTo: `/workflows/${wf.id}`,
    meta: { healthScore: wf.healthScore, stoplight: wf.stoplight, status: wf.status },
  }));
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.get("/drill", async (req, res) => {
  try {
    const { signal, propertyId, workflowId, stageId } = req.query as Record<string, string>;

    if (!signal || !SIGNAL_META[signal]) {
      res.status(400).json({ error: `Invalid or missing signal type. Valid types: ${Object.keys(SIGNAL_META).join(", ")}` });
      return;
    }

    const meta = SIGNAL_META[signal];
    let rows: DrillRow[] = [];

    if (signal === "expired_warranty" || signal === "expiring_soon") {
      rows = await assetWarrantyDrill(signal, propertyId ? parseInt(propertyId) : undefined);
    } else if (signal === "critical_items") {
      rows = await criticalItemsDrill();
    } else if (signal === "overdue_items") {
      rows = await overdueItemsDrill();
    } else if (signal === "bottleneck_items") {
      rows = await bottleneckItemsDrill(
        workflowId ? parseInt(workflowId) : undefined,
        stageId ? parseInt(stageId) : undefined,
      );
    } else if (signal === "stale_items") {
      rows = await staleItemsDrill(workflowId ? parseInt(workflowId) : undefined);
    } else if (signal === "at_risk_workflows") {
      rows = await atRiskWorkflowsDrill();
    }

    const response: DrillResponse = {
      signal,
      title: meta.title,
      total: rows.length,
      triggerExplanation: meta.triggerExplanation,
      rows,
    };

    res.json(response);
  } catch (err) {
    req.log.error({ err }, "Drill query failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
