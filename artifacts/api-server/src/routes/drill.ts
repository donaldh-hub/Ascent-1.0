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
  workOrdersTable,
} from "@workspace/db/schema";
import { eq, and, lt, ne, inArray, or, desc } from "drizzle-orm";
import { getReplacementCost } from "../lib/cost-lookup";

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
  cost?: number | null;
  meta: Record<string, unknown>;
}

interface DrillResponse {
  signal: string;
  title: string;
  total: number;
  totalCost?: number | null;
  costMatchedCount?: number;
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
  sla_violations: {
    title: "SLA Violations",
    triggerExplanation:
      "These work orders exceeded the 24-hour first-response SLA. Each missed SLA represents a service commitment failure and increases tenant dissatisfaction risk.",
  },
  aging_work_orders: {
    title: "Aging Work Orders",
    triggerExplanation:
      "These work orders have been in progress for 7 or more days without resolution. Prolonged open tickets indicate bottlenecks in your maintenance operation.",
  },
  category_spike: {
    title: "High-Volume Work Order Category",
    triggerExplanation:
      "The category listed here has the highest volume of open work orders, indicating a systemic issue requiring targeted attention.",
  },
  blocked_turns: {
    title: "Blocked Turn Records",
    triggerExplanation:
      "These work order records are actively blocked — a confirmed gate or external dependency is preventing progress. Each blocked turn directly delays unit rent-readiness.",
  },
  stage_congestion: {
    title: "Stage Congestion — Turn Bottleneck",
    triggerExplanation:
      "These records are stalled in the same turn stage, creating a congestion point. The stage is the primary bottleneck slowing make-ready completion across the portfolio.",
  },
  rework_loop: {
    title: "Rework Loop — Inspection Failures",
    triggerExplanation:
      "These units failed inspection and entered a rework cycle. Each re-entry extends the turn timeline and increases labor cost without advancing unit readiness.",
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
    const cost = getReplacementCost(a.assetType);

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
      cost,
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

// ─── Work Order Drill Functions ───────────────────────────────────────────────

async function slaViolationsDrill(propertyId?: number): Promise<DrillRow[]> {
  const wos = await db
    .select()
    .from(workOrdersTable)
    .where(
      propertyId
        ? and(eq(workOrdersTable.slaStatus, "missed"), eq(workOrdersTable.propertyId, propertyId))
        : eq(workOrdersTable.slaStatus, "missed")
    )
    .orderBy(desc(workOrdersTable.slaResponseDelayHours))
    .limit(100);

  // Enrich with unit numbers
  const unitIds = [...new Set(wos.map(w => w.unitId).filter(Boolean))] as number[];
  const units = unitIds.length
    ? await db.select({ id: unitsTable.id, unitNumber: unitsTable.unitNumber })
        .from(unitsTable).where(inArray(unitsTable.id, unitIds))
    : [];
  const unitMap = new Map(units.map(u => [u.id, u.unitNumber]));

  const propIds = [...new Set(wos.map(w => w.propertyId).filter(Boolean))] as number[];
  const props = propIds.length
    ? await db.select({ id: propertiesTable.id, name: propertiesTable.name })
        .from(propertiesTable).where(inArray(propertiesTable.id, propIds))
    : [];
  const propMap = new Map(props.map(p => [p.id, p.name]));

  return wos.map(wo => {
    const unitNumber = wo.unitId ? unitMap.get(wo.unitId) : undefined;
    const propertyName = wo.propertyId ? propMap.get(wo.propertyId) : undefined;
    const delayHours = wo.slaResponseDelayHours ?? 0;
    const subtitle = [
      propertyName,
      unitNumber ? `Unit ${unitNumber}` : null,
      wo.category,
    ].filter(Boolean).join(" · ");

    return {
      id: wo.id,
      title: wo.description?.slice(0, 60) ?? wo.category ?? "Work Order",
      subtitle,
      type: "item" as DrillRowType,
      badge: `${Math.round(delayHours)}h late`,
      badgeColor: delayHours > 48 ? ("red" as BadgeColor) : ("yellow" as BadgeColor),
      meta: {
        externalId: wo.externalId,
        category: wo.category,
        priority: wo.priority,
        slaDelayHours: wo.slaResponseDelayHours,
        status: wo.status,
        createdDate: wo.createdDate?.toISOString(),
      },
    };
  });
}

async function agingWorkOrdersDrill(propertyId?: number): Promise<DrillRow[]> {
  const agingThreshold = new Date(Date.now() - 7 * 86_400_000);

  const wos = await db
    .select()
    .from(workOrdersTable)
    .where(
      propertyId
        ? and(
            eq(workOrdersTable.status, "in_progress"),
            lt(workOrdersTable.createdDate, agingThreshold),
            eq(workOrdersTable.propertyId, propertyId)
          )
        : and(
            eq(workOrdersTable.status, "in_progress"),
            lt(workOrdersTable.createdDate, agingThreshold)
          )
    )
    .orderBy(workOrdersTable.createdDate)
    .limit(100);

  const unitIds = [...new Set(wos.map(w => w.unitId).filter(Boolean))] as number[];
  const units = unitIds.length
    ? await db.select({ id: unitsTable.id, unitNumber: unitsTable.unitNumber })
        .from(unitsTable).where(inArray(unitsTable.id, unitIds))
    : [];
  const unitMap = new Map(units.map(u => [u.id, u.unitNumber]));

  const propIds = [...new Set(wos.map(w => w.propertyId).filter(Boolean))] as number[];
  const props = propIds.length
    ? await db.select({ id: propertiesTable.id, name: propertiesTable.name })
        .from(propertiesTable).where(inArray(propertiesTable.id, propIds))
    : [];
  const propMap = new Map(props.map(p => [p.id, p.name]));

  return wos.map(wo => {
    const unitNumber = wo.unitId ? unitMap.get(wo.unitId) : undefined;
    const propertyName = wo.propertyId ? propMap.get(wo.propertyId) : undefined;
    const daysOpen = wo.createdDate
      ? Math.round((Date.now() - wo.createdDate.getTime()) / 86_400_000)
      : 0;
    const subtitle = [
      propertyName,
      unitNumber ? `Unit ${unitNumber}` : null,
      wo.category,
    ].filter(Boolean).join(" · ");

    return {
      id: wo.id,
      title: wo.description?.slice(0, 60) ?? wo.category ?? "Work Order",
      subtitle,
      type: "item" as DrillRowType,
      badge: `${daysOpen}d open`,
      badgeColor: daysOpen > 14 ? ("red" as BadgeColor) : ("yellow" as BadgeColor),
      meta: {
        externalId: wo.externalId,
        category: wo.category,
        priority: wo.priority,
        daysOpen,
        status: wo.status,
        createdDate: wo.createdDate?.toISOString(),
      },
    };
  });
}

async function categorySpikesDrill(propertyId?: number): Promise<DrillRow[]> {
  const wos = await db
    .select()
    .from(workOrdersTable)
    .where(
      propertyId
        ? and(
            ne(workOrdersTable.status, "completed"),
            ne(workOrdersTable.status, "cancelled"),
            eq(workOrdersTable.propertyId, propertyId)
          )
        : and(
            ne(workOrdersTable.status, "completed"),
            ne(workOrdersTable.status, "cancelled"),
          )
    )
    .limit(500);

  // Group by category
  const catMap = new Map<string, typeof wos>();
  for (const wo of wos) {
    const cat = wo.category ?? "General";
    if (!catMap.has(cat)) catMap.set(cat, []);
    catMap.get(cat)!.push(wo);
  }

  // Sort by count descending
  const sorted = Array.from(catMap.entries()).sort((a, b) => b[1].length - a[1].length);

  // Return rows for the top category's work orders
  if (sorted.length === 0) return [];

  const [topCat, topWos] = sorted[0];

  const unitIds = [...new Set(topWos.map(w => w.unitId).filter(Boolean))] as number[];
  const units = unitIds.length
    ? await db.select({ id: unitsTable.id, unitNumber: unitsTable.unitNumber })
        .from(unitsTable).where(inArray(unitsTable.id, unitIds))
    : [];
  const unitMap = new Map(units.map(u => [u.id, u.unitNumber]));

  return topWos.slice(0, 50).map(wo => {
    const unitNumber = wo.unitId ? unitMap.get(wo.unitId) : undefined;
    return {
      id: wo.id,
      title: wo.description?.slice(0, 60) ?? topCat,
      subtitle: unitNumber ? `Unit ${unitNumber}` : (wo.status ?? "open"),
      type: "item" as DrillRowType,
      badge: topCat,
      badgeColor: "blue" as BadgeColor,
      meta: {
        externalId: wo.externalId,
        category: wo.category,
        priority: wo.priority,
        status: wo.status,
        createdDate: wo.createdDate?.toISOString(),
      },
    };
  });
}

// ─── Blocked Turns Drill ──────────────────────────────────────────────────────

async function blockedTurnsDrill(propertyId?: number): Promise<DrillRow[]> {
  const conditions = [eq(workOrdersTable.isBlocked, true)];
  if (propertyId) conditions.push(eq(workOrdersTable.propertyId, propertyId));

  const wos = await db
    .select()
    .from(workOrdersTable)
    .where(and(...conditions))
    .orderBy(desc(workOrdersTable.daysInStage))
    .limit(100);

  const unitIds = [...new Set(wos.map(w => w.unitId).filter(Boolean))] as number[];
  const units = unitIds.length
    ? await db.select({ id: unitsTable.id, unitNumber: unitsTable.unitNumber })
        .from(unitsTable).where(inArray(unitsTable.id, unitIds))
    : [];
  const unitMap = new Map(units.map(u => [u.id, u.unitNumber]));

  const propIds = [...new Set(wos.map(w => w.propertyId).filter(Boolean))] as number[];
  const props = propIds.length
    ? await db.select({ id: propertiesTable.id, name: propertiesTable.name })
        .from(propertiesTable).where(inArray(propertiesTable.id, propIds))
    : [];
  const propMap = new Map(props.map(p => [p.id, p.name]));

  return wos.map(wo => {
    const unitLabel = wo.unitId ? (unitMap.get(wo.unitId) ? `Unit ${unitMap.get(wo.unitId)}` : null) : (wo.unitNumberRaw ? `Unit ${wo.unitNumberRaw}` : null);
    const propertyLabel = wo.propertyId ? propMap.get(wo.propertyId) : wo.propertyNameRaw;
    const days = wo.daysInStage ?? (wo.createdDate ? Math.round((Date.now() - wo.createdDate.getTime()) / 86_400_000) : 0);
    const subtitle = [propertyLabel, unitLabel, wo.stage].filter(Boolean).join(" · ");

    return {
      id: wo.id,
      rowType: "item" as DrillRowType,
      title: wo.description?.slice(0, 60) ?? wo.category ?? "Blocked Turn",
      subtitle,
      detail: [
        `${days}d in ${wo.stage ?? "stage"}`,
        wo.delayReason ?? null,
        wo.vendor ? `Vendor: ${wo.vendor}` : null,
      ].filter(Boolean).join(" · "),
      badge: wo.priority === "critical" ? "CRITICAL BLOCK" : `${days}d BLOCKED`,
      badgeColor: (wo.priority === "critical" || days > 7) ? "red" as BadgeColor : "yellow" as BadgeColor,
      navigateTo: wo.unitId ? `/units/${wo.unitId}` : "/work-orders",
      meta: {
        externalId: wo.externalId,
        turnId: wo.turnId,
        stage: wo.stage,
        stageStatus: wo.stageStatus,
        daysInStage: wo.daysInStage,
        delayReason: wo.delayReason,
        vendor: wo.vendor,
        bottleneckType: wo.bottleneckType,
        priority: wo.priority,
        propertyName: propertyLabel,
        unitNumber: unitLabel,
        regionName: wo.regionName,
      },
    };
  });
}

// ─── Stage Congestion Drill ───────────────────────────────────────────────────

async function stageCongestionDrill(stage?: string, propertyId?: number): Promise<DrillRow[]> {
  // Get all blocked work orders grouped by stage
  const conditions = [eq(workOrdersTable.isBlocked, true)];
  if (stage) conditions.push(eq(workOrdersTable.stage, stage));
  if (propertyId) conditions.push(eq(workOrdersTable.propertyId, propertyId));

  let wos = await db
    .select()
    .from(workOrdersTable)
    .where(and(...conditions))
    .orderBy(desc(workOrdersTable.daysInStage))
    .limit(100);

  // If no stage filter, find the most congested stage first
  if (!stage && wos.length > 0) {
    const stageCount = new Map<string, number>();
    for (const wo of wos) {
      if (wo.stage) stageCount.set(wo.stage, (stageCount.get(wo.stage) ?? 0) + 1);
    }
    const topStage = Array.from(stageCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topStage) {
      wos = wos.filter(wo => wo.stage === topStage);
    }
  }

  const propIds = [...new Set(wos.map(w => w.propertyId).filter(Boolean))] as number[];
  const props = propIds.length
    ? await db.select({ id: propertiesTable.id, name: propertiesTable.name })
        .from(propertiesTable).where(inArray(propertiesTable.id, propIds))
    : [];
  const propMap = new Map(props.map(p => [p.id, p.name]));

  return wos.map(wo => {
    const propertyLabel = wo.propertyId ? propMap.get(wo.propertyId) : wo.propertyNameRaw;
    const unitLabel = wo.unitNumberRaw ? `Unit ${wo.unitNumberRaw}` : null;
    const days = wo.daysInStage ?? 0;

    return {
      id: wo.id,
      rowType: "item" as DrillRowType,
      title: wo.description?.slice(0, 60) ?? `Stalled at ${wo.stage ?? "stage"}`,
      subtitle: [propertyLabel, unitLabel].filter(Boolean).join(" · "),
      detail: [
        `${days}d in ${wo.stage ?? "stage"}`,
        wo.delayReason,
        wo.assignedTo ? `Assigned: ${wo.assignedTo}` : null,
      ].filter(Boolean).join(" · "),
      badge: `${days}d STALLED`,
      badgeColor: days > 7 ? "red" as BadgeColor : "yellow" as BadgeColor,
      navigateTo: wo.unitId ? `/units/${wo.unitId}` : "/work-orders",
      meta: {
        externalId: wo.externalId,
        turnId: wo.turnId,
        stage: wo.stage,
        daysInStage: wo.daysInStage,
        delayReason: wo.delayReason,
        vendor: wo.vendor,
        bottleneckType: wo.bottleneckType,
        regionName: wo.regionName,
        propertyName: propertyLabel,
      },
    };
  });
}

// ─── Rework Loop Drill ────────────────────────────────────────────────────────

async function reworkLoopDrill(propertyId?: number): Promise<DrillRow[]> {
  const conditions = [eq(workOrdersTable.bottleneckType, "rework_loop")];
  if (propertyId) conditions.push(eq(workOrdersTable.propertyId, propertyId));

  const wos = await db
    .select()
    .from(workOrdersTable)
    .where(and(...conditions))
    .orderBy(desc(workOrdersTable.daysInStage))
    .limit(100);

  const propIds = [...new Set(wos.map(w => w.propertyId).filter(Boolean))] as number[];
  const props = propIds.length
    ? await db.select({ id: propertiesTable.id, name: propertiesTable.name })
        .from(propertiesTable).where(inArray(propertiesTable.id, propIds))
    : [];
  const propMap = new Map(props.map(p => [p.id, p.name]));

  return wos.map(wo => {
    const propertyLabel = wo.propertyId ? propMap.get(wo.propertyId) : wo.propertyNameRaw;
    const unitLabel = wo.unitNumberRaw ? `Unit ${wo.unitNumberRaw}` : null;
    const days = wo.daysInStage ?? 0;

    return {
      id: wo.id,
      rowType: "item" as DrillRowType,
      title: wo.description?.slice(0, 60) ?? `Rework — ${wo.stage ?? "inspection"}`,
      subtitle: [propertyLabel, unitLabel, wo.stage].filter(Boolean).join(" · "),
      detail: [
        `${days}d in rework`,
        wo.delayReason,
      ].filter(Boolean).join(" · "),
      badge: wo.stage === "Rework" ? "REWORK" : "FAILED INSPECTION",
      badgeColor: "red" as BadgeColor,
      navigateTo: wo.unitId ? `/units/${wo.unitId}` : "/work-orders",
      meta: {
        externalId: wo.externalId,
        turnId: wo.turnId,
        stage: wo.stage,
        daysInStage: wo.daysInStage,
        delayReason: wo.delayReason,
        regionName: wo.regionName,
        propertyName: propertyLabel,
      },
    };
  });
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
    } else if (signal === "sla_violations") {
      rows = await slaViolationsDrill(propertyId ? parseInt(propertyId) : undefined);
    } else if (signal === "aging_work_orders") {
      rows = await agingWorkOrdersDrill(propertyId ? parseInt(propertyId) : undefined);
    } else if (signal === "category_spike") {
      rows = await categorySpikesDrill(propertyId ? parseInt(propertyId) : undefined);
    } else if (signal === "blocked_turns") {
      rows = await blockedTurnsDrill(propertyId ? parseInt(propertyId) : undefined);
    } else if (signal === "stage_congestion") {
      rows = await stageCongestionDrill(
        req.query.stage as string | undefined,
        propertyId ? parseInt(propertyId) : undefined
      );
    } else if (signal === "rework_loop") {
      rows = await reworkLoopDrill(propertyId ? parseInt(propertyId) : undefined);
    }

    // Compute cost totals for asset signals
    let totalCost: number | null = null;
    let costMatchedCount = 0;
    if (signal === "expired_warranty" || signal === "expiring_soon") {
      let sum = 0;
      for (const row of rows) {
        if (row.cost != null) {
          sum += row.cost;
          costMatchedCount++;
        }
      }
      totalCost = costMatchedCount > 0 ? sum : null;
    }

    const response: DrillResponse = {
      signal,
      title: meta.title,
      total: rows.length,
      totalCost,
      costMatchedCount: costMatchedCount > 0 ? costMatchedCount : undefined,
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
