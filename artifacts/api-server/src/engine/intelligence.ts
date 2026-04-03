/**
 * Phase 1 – Build 5: Dashboard Intelligence Layer
 *
 * Aggregates scoring, alerts, bottlenecks, and item data into structured
 * intelligence outputs for the control tower dashboard.
 *
 * Design principles:
 * - No UI logic. No DB calls. Pure aggregation from engine outputs.
 * - Every output field derived from real data — no hardcoded values.
 * - Supports explainability: every metric includes reason/insight text.
 */

import { loadAllWorkflowInputs, loadAlerts } from "./loader";
import {
  calcWorkflowHealth,
  calcOperationalHealth,
  calcStoplight,
  type WorkflowHealthResult,
} from "./scoring";
import type { WorkflowInput, ItemInput } from "./scoring";

// ─────────────────────────────────────────────
// Helper utilities
// ─────────────────────────────────────────────

function daysSince(date: Date): number {
  return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
}

function isOverdue(item: ItemInput): boolean {
  return !!item.dueDate && new Date(item.dueDate).getTime() < Date.now();
}

function isCritical(item: ItemInput): boolean {
  return (
    item.priority === "critical" ||
    (item.priority === "high" && isOverdue(item)) ||
    daysSince(item.stageEnteredAt) > 21
  );
}

// ─────────────────────────────────────────────
// Executive Snapshot
// ─────────────────────────────────────────────

export interface ExecutiveSnapshot {
  operationalHealthScore: number;
  stoplight: string;
  insight: string;
  criticalItemsCount: number;
  openItemsCount: number;
  overdueItemsCount: number;
  activeWorkflowsCount: number;
  completedWorkflowsCount: number;
  biggestBottleneck: string | null;
  biggestBottleneckExplanation: string | null;
  throughputPercent: number;
  throughputLabel: string;
  improvementSignal: string;
  longestAgingItem: { title: string; daysInStage: number; workflowTitle: string } | null;
}

export async function buildExecutiveSnapshot(): Promise<ExecutiveSnapshot> {
  const [workflowInputs, alerts] = await Promise.all([
    loadAllWorkflowInputs(),
    loadAlerts(),
  ]);

  const operational = calcOperationalHealth(workflowInputs, alerts);
  const activeWorkflows = workflowInputs.filter(
    (w) => w.status === "active" || w.status === "paused"
  );
  const completedWorkflows = workflowInputs.filter((w) => w.status === "completed");

  const allOpenItems = workflowInputs.flatMap((w) =>
    w.items.filter((i) => i.status !== "completed")
  );

  const criticalItems = allOpenItems.filter(isCritical);
  const overdueItems = allOpenItems.filter(isOverdue);

  // Throughput: completed / total workflows as a percentage
  const throughputPercent =
    workflowInputs.length > 0
      ? Math.round((completedWorkflows.length / workflowInputs.length) * 100)
      : 0;
  const throughputLabel =
    completedWorkflows.length > 0
      ? `${completedWorkflows.length} workflow${completedWorkflows.length !== 1 ? "s" : ""} completed`
      : "No workflows completed yet";

  // Biggest bottleneck
  let biggestBottleneck: string | null = null;
  let biggestBottleneckExplanation: string | null = null;
  if (operational.biggestBottleneckWorkflow && operational.biggestBottleneckStage) {
    biggestBottleneck = `${operational.biggestBottleneckWorkflow} — ${operational.biggestBottleneckStage}`;
    biggestBottleneckExplanation = `Stage "${operational.biggestBottleneckStage}" in "${operational.biggestBottleneckWorkflow}" has the highest item concentration and is the primary flow constraint.`;
  } else if (operational.biggestBottleneckWorkflow) {
    biggestBottleneck = operational.biggestBottleneckWorkflow;
    biggestBottleneckExplanation = `"${operational.biggestBottleneckWorkflow}" is the most constrained workflow.`;
  }

  // Longest aging open item
  let longestAgingItem: ExecutiveSnapshot["longestAgingItem"] = null;
  let maxAgeDays = 0;
  for (const wf of workflowInputs) {
    for (const item of wf.items.filter((i) => i.status !== "completed")) {
      const days = daysSince(item.stageEnteredAt);
      if (days > maxAgeDays) {
        maxAgeDays = days;
        longestAgingItem = {
          title: item.title,
          daysInStage: Math.round(days),
          workflowTitle: wf.title,
        };
      }
    }
  }

  // Improvement signal
  const recentlyCompleted = workflowInputs.flatMap((w) =>
    w.items.filter(
      (i) => i.status === "completed" && daysSince(i.updatedAt) <= 7
    )
  ).length;
  const improvementSignal =
    recentlyCompleted > 0
      ? `${recentlyCompleted} item${recentlyCompleted !== 1 ? "s" : ""} completed in the last 7 days`
      : "No items completed recently — check for stalled work";

  return {
    operationalHealthScore: operational.operationalHealthScore,
    stoplight: operational.stoplight,
    insight: operational.insight,
    criticalItemsCount: criticalItems.length,
    openItemsCount: allOpenItems.length,
    overdueItemsCount: overdueItems.length,
    activeWorkflowsCount: activeWorkflows.length,
    completedWorkflowsCount: completedWorkflows.length,
    biggestBottleneck,
    biggestBottleneckExplanation,
    throughputPercent,
    throughputLabel,
    improvementSignal,
    longestAgingItem,
  };
}

// ─────────────────────────────────────────────
// Action Panel
// ─────────────────────────────────────────────

export type ActionCategory = "critical_item" | "bottleneck" | "overdue" | "unassigned" | "health" | "aging";
export type ActionUrgency = "critical" | "high" | "medium";

export interface IntelligenceAction {
  id: string;
  category: ActionCategory;
  urgency: ActionUrgency;
  title: string;
  reason: string;
  actionPath: string;
  workflowId: number | null;
  workflowTitle: string | null;
  metadata: Record<string, unknown>;
}

export async function buildActionPanel(limit = 6): Promise<IntelligenceAction[]> {
  const workflowInputs = await loadAllWorkflowInputs();
  const actions: IntelligenceAction[] = [];

  for (const wf of workflowInputs) {
    const openItems = wf.items.filter((i) => i.status !== "completed");

    // Critical priority items — highest urgency
    for (const item of openItems.filter((i) => i.priority === "critical")) {
      const stage = wf.stages.find((s) => s.id === item.stageId);
      const daysInStage = Math.round(daysSince(item.stageEnteredAt));
      actions.push({
        id: `critical_item_${item.id}`,
        category: "critical_item",
        urgency: "critical",
        title: `Critical item needs action: ${item.title}`,
        reason: `"${item.title}" is a critical-priority item in stage "${stage?.name ?? "unknown"}" of "${wf.title}". ${daysInStage > 0 ? `It has been here for ${daysInStage} day${daysInStage !== 1 ? "s" : ""}.` : ""}`,
        actionPath: `/workflows/${wf.id}`,
        workflowId: wf.id,
        workflowTitle: wf.title,
        metadata: { itemId: item.id, priority: item.priority, daysInStage, stageName: stage?.name },
      });
    }

    // Overdue items
    for (const item of openItems.filter(isOverdue)) {
      const stage = wf.stages.find((s) => s.id === item.stageId);
      const overdueDays = Math.round(
        (Date.now() - new Date(item.dueDate!).getTime()) / (1000 * 60 * 60 * 24)
      );
      const urgency: ActionUrgency = item.priority === "critical" || item.priority === "high" ? "critical" : "high";
      actions.push({
        id: `overdue_${item.id}`,
        category: "overdue",
        urgency,
        title: `Overdue item: ${item.title}`,
        reason: `"${item.title}" in "${wf.title}" is ${overdueDays} day${overdueDays !== 1 ? "s" : ""} past its due date. Stage: "${stage?.name ?? "unknown"}".`,
        actionPath: `/workflows/${wf.id}`,
        workflowId: wf.id,
        workflowTitle: wf.title,
        metadata: { itemId: item.id, overdueDays, dueDate: item.dueDate, stageName: stage?.name },
      });
    }

    // Bottlenecks — stage with ≥2 open items
    const stageCounts = openItems.reduce((acc, i) => {
      acc[i.stageId] = (acc[i.stageId] ?? 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    for (const [stageIdStr, count] of Object.entries(stageCounts)) {
      if (count < 2) continue;
      const stage = wf.stages.find((s) => s.id === Number(stageIdStr));
      const stageItems = openItems.filter((i) => i.stageId === Number(stageIdStr));
      const maxAge = Math.round(Math.max(...stageItems.map((i) => daysSince(i.stageEnteredAt))));
      actions.push({
        id: `bottleneck_${wf.id}_${stageIdStr}`,
        category: "bottleneck",
        urgency: maxAge > 14 || stageItems.some((i) => i.priority === "critical") ? "critical" : "high",
        title: `Bottleneck: ${stage?.name ?? "Stage"} in ${wf.title}`,
        reason: `${count} items are concentrated in "${stage?.name ?? "unknown stage"}" of "${wf.title}". Oldest has been here ${maxAge} day${maxAge !== 1 ? "s" : ""}. This stage is restricting flow.`,
        actionPath: `/workflows/${wf.id}`,
        workflowId: wf.id,
        workflowTitle: wf.title,
        metadata: { stageId: Number(stageIdStr), stageName: stage?.name, itemCount: count, maxAge },
      });
    }

    // Unassigned high/critical items
    const unassigned = openItems.filter(
      (i) =>
        (i.priority === "critical" || i.priority === "high") &&
        (!i.assignedTo || !i.assignedTo.trim())
    );
    if (unassigned.length > 0) {
      actions.push({
        id: `unassigned_${wf.id}`,
        category: "unassigned",
        urgency: unassigned.some((i) => i.priority === "critical") ? "critical" : "high",
        title: `Assign owners in: ${wf.title}`,
        reason: `${unassigned.length} high/critical item${unassigned.length !== 1 ? "s" : ""} in "${wf.title}" ${unassigned.length === 1 ? "has" : "have"} no assigned owner. Unowned items are at higher risk of stalling.`,
        actionPath: `/workflows/${wf.id}`,
        workflowId: wf.id,
        workflowTitle: wf.title,
        metadata: { unassignedCount: unassigned.length },
      });
    }

    // Severely aging items (>14 days in stage)
    for (const item of openItems.filter((i) => daysSince(i.stageEnteredAt) > 14 && !isCritical(i))) {
      const stage = wf.stages.find((s) => s.id === item.stageId);
      const daysInStage = Math.round(daysSince(item.stageEnteredAt));
      actions.push({
        id: `aging_${item.id}`,
        category: "aging",
        urgency: "medium",
        title: `Aging item needs review: ${item.title}`,
        reason: `"${item.title}" has been in "${stage?.name ?? "unknown stage"}" of "${wf.title}" for ${daysInStage} days without movement.`,
        actionPath: `/workflows/${wf.id}`,
        workflowId: wf.id,
        workflowTitle: wf.title,
        metadata: { itemId: item.id, daysInStage, stageName: stage?.name },
      });
    }
  }

  // Deduplicate by id, sort by urgency, take top N
  const seen = new Set<string>();
  const unique = actions.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  const urgencyOrder: Record<ActionUrgency, number> = { critical: 0, high: 1, medium: 2 };
  unique.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

  return unique.slice(0, limit);
}

// ─────────────────────────────────────────────
// Bottleneck Intelligence (Story)
// ─────────────────────────────────────────────

export interface BottleneckStory {
  workflowId: number;
  workflowTitle: string;
  stageName: string;
  stageId: number;
  itemCount: number;
  maxAgeDays: number;
  avgAgeDays: number;
  hasCritical: boolean;
  stoplight: string;
  impactSummary: string;
  recommendation: string;
}

export async function buildBottleneckIntelligence(): Promise<BottleneckStory | null> {
  const workflowInputs = await loadAllWorkflowInputs();

  let worstBottleneck: BottleneckStory | null = null;
  let worstScore = 0;

  for (const wf of workflowInputs.filter((w) => w.status === "active" || w.status === "paused")) {
    const openItems = wf.items.filter((i) => i.status !== "completed");
    if (openItems.length === 0) continue;

    const stageCounts = openItems.reduce((acc, i) => {
      acc[i.stageId] = (acc[i.stageId] ?? 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    for (const [stageIdStr, count] of Object.entries(stageCounts)) {
      if (count < 2) continue;
      const stageId = Number(stageIdStr);
      const stage = wf.stages.find((s) => s.id === stageId);
      const stageItems = openItems.filter((i) => i.stageId === stageId);
      const maxAge = Math.round(Math.max(...stageItems.map((i) => daysSince(i.stageEnteredAt))));
      const avgAge = Math.round(
        stageItems.reduce((s, i) => s + daysSince(i.stageEnteredAt), 0) / stageItems.length
      );
      const hasCritical = stageItems.some((i) => i.priority === "critical");

      // Severity score: count * 2 + age factor + critical bonus
      const score = count * 2 + (maxAge / 7) + (hasCritical ? 20 : 0);
      if (score <= worstScore) continue;
      worstScore = score;

      const stoplight = hasCritical || maxAge > 14 ? "red" : "yellow";

      const impactSummary = [
        `"${stage?.name ?? "Stage"}" in "${wf.title}" has ${count} open item${count !== 1 ? "s" : ""} concentrated, with the oldest aged ${maxAge} day${maxAge !== 1 ? "s" : ""}.`,
        hasCritical ? "Critical-priority items are present, elevating risk." : "",
        avgAge > 7 ? `Items are averaging ${avgAge} days in this stage, indicating systemic slowdown.` : "",
      ]
        .filter(Boolean)
        .join(" ");

      const recommendation =
        hasCritical
          ? "Escalate critical items immediately. Review blocking dependencies."
          : maxAge > 14
          ? "Audit items for blockers. Consider re-prioritizing or reassigning."
          : "Review stage for process friction. Distribute workload if possible.";

      worstBottleneck = {
        workflowId: wf.id,
        workflowTitle: wf.title,
        stageName: stage?.name ?? "Unknown Stage",
        stageId,
        itemCount: count,
        maxAgeDays: maxAge,
        avgAgeDays: avgAge,
        hasCritical,
        stoplight,
        impactSummary,
        recommendation,
      };
    }
  }

  return worstBottleneck;
}

// ─────────────────────────────────────────────
// Stage Distribution (for visual chart)
// ─────────────────────────────────────────────

export interface StageDistributionRow {
  workflowId: number;
  workflowTitle: string;
  stageId: number;
  stageName: string;
  stageOrder: number;
  openItems: number;
  completedItems: number;
  avgAgeDays: number;
  isBottleneck: boolean;
}

export async function buildStageDistribution(): Promise<StageDistributionRow[]> {
  const workflowInputs = await loadAllWorkflowInputs();
  const rows: StageDistributionRow[] = [];

  for (const wf of workflowInputs.filter((w) => w.status === "active" || w.status === "paused")) {
    if (wf.stages.length === 0) continue;
    const allItems = wf.items;

    // Find bottleneck stage
    const openItems = allItems.filter((i) => i.status !== "completed");
    const stageCounts = openItems.reduce((acc, i) => {
      acc[i.stageId] = (acc[i.stageId] ?? 0) + 1;
      return acc;
    }, {} as Record<number, number>);
    const maxStageCount = Math.max(0, ...Object.values(stageCounts));
    const bottleneckStageId =
      maxStageCount >= 2
        ? Number(Object.keys(stageCounts).find((id) => stageCounts[Number(id)] === maxStageCount))
        : null;

    for (const stage of wf.stages) {
      const stageOpen = openItems.filter((i) => i.stageId === stage.id);
      const stageCompleted = allItems.filter(
        (i) => i.status === "completed" && i.stageId === stage.id
      );
      const avgAge =
        stageOpen.length > 0
          ? Math.round(
              stageOpen.reduce((s, i) => s + daysSince(i.stageEnteredAt), 0) / stageOpen.length
            )
          : 0;

      rows.push({
        workflowId: wf.id,
        workflowTitle: wf.title,
        stageId: stage.id,
        stageName: stage.name,
        stageOrder: stage.order,
        openItems: stageOpen.length,
        completedItems: stageCompleted.length,
        avgAgeDays: avgAge,
        isBottleneck: stage.id === bottleneckStageId,
      });
    }
  }

  return rows;
}

// ─────────────────────────────────────────────
// Workflow Spotlight (top workflows by concern)
// ─────────────────────────────────────────────

export interface WorkflowSpotlightEntry {
  workflowId: number;
  title: string;
  status: string;
  healthScore: number;
  stoplight: string;
  openItems: number;
  criticalItems: number;
  overdueItems: number;
  hasBottleneck: boolean;
  bottleneckStageName: string | null;
  concernReason: string;
  concernLevel: "critical" | "warning" | "healthy";
  flowScore: number;
  riskScore: number;
}

export async function buildWorkflowSpotlight(limit = 6): Promise<WorkflowSpotlightEntry[]> {
  const workflowInputs = await loadAllWorkflowInputs();

  const entries: WorkflowSpotlightEntry[] = workflowInputs
    .filter((w) => w.status === "active" || w.status === "paused")
    .map((wf) => {
      const health = calcWorkflowHealth(wf);
      const openItems = wf.items.filter((i) => i.status !== "completed");
      const criticalItems = openItems.filter(isCritical);
      const overdueItems = openItems.filter(isOverdue);

      // Detect bottleneck
      const stageCounts = openItems.reduce((acc, i) => {
        acc[i.stageId] = (acc[i.stageId] ?? 0) + 1;
        return acc;
      }, {} as Record<number, number>);
      const maxCount = Math.max(0, ...Object.values(stageCounts));
      const bottleneckStageId = maxCount >= 2
        ? Number(Object.keys(stageCounts).find((id) => stageCounts[Number(id)] === maxCount))
        : null;
      const bottleneckStage = bottleneckStageId
        ? wf.stages.find((s) => s.id === bottleneckStageId)
        : null;

      // Concern scoring
      let concernScore = 0;
      const reasons: string[] = [];

      if (health.healthScore < 50) { concernScore += 50; reasons.push("health critical"); }
      else if (health.healthScore < 75) { concernScore += 25; reasons.push("health at risk"); }

      if (criticalItems.length > 0) {
        concernScore += criticalItems.length * 20;
        reasons.push(`${criticalItems.length} critical item${criticalItems.length !== 1 ? "s" : ""}`);
      }
      if (overdueItems.length > 0) {
        concernScore += overdueItems.length * 10;
        reasons.push(`${overdueItems.length} overdue`);
      }
      if (bottleneckStage) {
        concernScore += 15;
        reasons.push(`bottleneck in ${bottleneckStage.name}`);
      }

      const concernLevel: WorkflowSpotlightEntry["concernLevel"] =
        concernScore >= 50 ? "critical" : concernScore >= 20 ? "warning" : "healthy";

      const concernReason =
        reasons.length > 0
          ? reasons.slice(0, 2).join(", ")
          : health.insight;

      return {
        workflowId: wf.id,
        title: wf.title,
        status: wf.status,
        healthScore: health.healthScore,
        stoplight: health.stoplight,
        openItems: openItems.length,
        criticalItems: criticalItems.length,
        overdueItems: overdueItems.length,
        hasBottleneck: !!bottleneckStage,
        bottleneckStageName: bottleneckStage?.name ?? null,
        concernReason,
        concernLevel,
        flowScore: health.flow.score,
        riskScore: health.risk.score,
      };
    });

  // Sort: critical first, then warning, then healthy; within each group by health asc
  entries.sort((a, b) => {
    const order = { critical: 0, warning: 1, healthy: 2 };
    const levelDiff = order[a.concernLevel] - order[b.concernLevel];
    if (levelDiff !== 0) return levelDiff;
    return a.healthScore - b.healthScore;
  });

  return entries.slice(0, limit);
}

// ─────────────────────────────────────────────
// Trend Signals
// ─────────────────────────────────────────────

export interface TrendSignal {
  label: string;
  value: string;
  direction: "up" | "down" | "stable" | "unknown";
  explanation: string;
  available: boolean;
}

export async function buildTrendSignals(): Promise<TrendSignal[]> {
  const workflowInputs = await loadAllWorkflowInputs();
  const allItems = workflowInputs.flatMap((w) => w.items);
  const openItems = allItems.filter((i) => i.status !== "completed");

  // Items completed in last 7 days
  const completedRecently = allItems.filter(
    (i) => i.status === "completed" && daysSince(i.updatedAt) <= 7
  ).length;

  // Items created in last 7 days
  const createdRecently = allItems.filter((i) => daysSince(i.createdAt) <= 7).length;

  // Items aging beyond 7 days
  const agingItems = openItems.filter((i) => daysSince(i.stageEnteredAt) > 7).length;

  // Overdue count
  const overdueCount = openItems.filter(isOverdue).length;

  // Critical items
  const criticalCount = openItems.filter(isCritical).length;

  // Congestion: average items per active stage
  const activeWorkflows = workflowInputs.filter(
    (w) => w.status === "active" || w.status === "paused"
  );
  const totalStages = activeWorkflows.reduce((s, w) => s + w.stages.length, 0);
  const avgItemsPerStage =
    totalStages > 0 ? (openItems.length / totalStages).toFixed(1) : "0";

  const hasEnoughData = allItems.length >= 3;

  return [
    {
      label: "Completion Activity",
      value: completedRecently > 0 ? `${completedRecently} item${completedRecently !== 1 ? "s" : ""} completed` : "No completions",
      direction:
        completedRecently > createdRecently
          ? "up"
          : completedRecently > 0
          ? "stable"
          : "down",
      explanation:
        completedRecently > 0
          ? `${completedRecently} item${completedRecently !== 1 ? "s" : ""} were completed in the last 7 days${createdRecently > 0 ? ` vs. ${createdRecently} created` : ""}.`
          : "No items have been completed recently. Look for blocked work.",
      available: hasEnoughData,
    },
    {
      label: "Aging Items",
      value: `${agingItems} item${agingItems !== 1 ? "s" : ""} aging`,
      direction:
        agingItems === 0 ? "up" : agingItems <= 2 ? "stable" : "down",
      explanation:
        agingItems === 0
          ? "No items have been sitting in a stage for more than 7 days — work is flowing."
          : `${agingItems} item${agingItems !== 1 ? "s" : ""} have been in the same stage for more than 7 days. Review for blockers.`,
      available: hasEnoughData,
    },
    {
      label: "Overdue Items",
      value: overdueCount > 0 ? `${overdueCount} overdue` : "None overdue",
      direction: overdueCount === 0 ? "up" : overdueCount <= 2 ? "stable" : "down",
      explanation:
        overdueCount === 0
          ? "All items are within their due dates."
          : `${overdueCount} item${overdueCount !== 1 ? "s" : ""} are past their scheduled due date.`,
      available: hasEnoughData,
    },
    {
      label: "Stage Congestion",
      value: `${avgItemsPerStage} items/stage avg`,
      direction:
        Number(avgItemsPerStage) <= 1
          ? "up"
          : Number(avgItemsPerStage) <= 2
          ? "stable"
          : "down",
      explanation:
        Number(avgItemsPerStage) <= 1
          ? "Stages are lightly loaded — work is distributed well."
          : `Average of ${avgItemsPerStage} items per active stage. Stages with high concentration may need attention.`,
      available: totalStages > 0,
    },
  ];
}

// ─────────────────────────────────────────────
// Full Intelligence Bundle (single call)
// ─────────────────────────────────────────────

export interface DashboardIntelligence {
  executiveSnapshot: ExecutiveSnapshot;
  actions: IntelligenceAction[];
  primaryBottleneck: BottleneckStory | null;
  stageDistribution: StageDistributionRow[];
  workflowSpotlight: WorkflowSpotlightEntry[];
  trends: TrendSignal[];
  generatedAt: string;
}

export async function buildDashboardIntelligence(): Promise<DashboardIntelligence> {
  const [executiveSnapshot, actions, primaryBottleneck, stageDistribution, workflowSpotlight, trends] =
    await Promise.all([
      buildExecutiveSnapshot(),
      buildActionPanel(6),
      buildBottleneckIntelligence(),
      buildStageDistribution(),
      buildWorkflowSpotlight(6),
      buildTrendSignals(),
    ]);

  return {
    executiveSnapshot,
    actions,
    primaryBottleneck,
    stageDistribution,
    workflowSpotlight,
    trends,
    generatedAt: new Date().toISOString(),
  };
}
