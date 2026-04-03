/**
 * Phase 1 – Build 4: Alert and Warning Engine
 *
 * Evaluates real workflow conditions and manages the alert lifecycle.
 * - Centralized rules with thresholds
 * - Deduplication via ruleKey
 * - Alert creation / update / resolution
 * - No scoring math duplicated — uses scoring engine outputs
 */

import { db } from "@workspace/db";
import { alertsTable, documentsTable, assetsTable } from "@workspace/db/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { loadAllWorkflowInputs } from "./loader";
import { calcWorkflowHealth } from "./scoring";
import type { WorkflowInput, ItemInput, StageInput } from "./scoring";

// ─────────────────────────────────────────────
// Centralized Thresholds
// ─────────────────────────────────────────────

export const ALERT_THRESHOLDS = {
  ITEM_AGING_WARNING_DAYS: 7,   // days in current stage → warning
  ITEM_AGING_CRITICAL_DAYS: 21, // days in current stage → critical
  ITEM_STUCK_DAYS: 14,          // days without movement → stuck warning
  BOTTLENECK_MIN_ITEMS: 2,      // items in one stage → bottleneck warning
  WORKFLOW_HEALTH_YELLOW: 75,   // score < threshold → workflow at risk
  WORKFLOW_HEALTH_RED: 50,      // score < threshold → workflow critical
} as const;

// ─────────────────────────────────────────────
// Alert Categories and Levels
// ─────────────────────────────────────────────

export type AlertCategory = "status_alert" | "timing_alert" | "flow_alert" | "risk_alert";
export type AlertLevel = "informational" | "warning" | "critical";

// ─────────────────────────────────────────────
// Candidate — a potential alert before DB write
// ─────────────────────────────────────────────

export interface AlertCandidate {
  ruleKey: string;
  type: string;
  category: AlertCategory;
  level: AlertLevel;
  severity: string; // legacy compat
  title: string;
  message: string;
  actionPath: string | null;
  workflowId: number | null;
  linkedItemId: number | null;
  linkedStageId: number | null;
  metadata: Record<string, unknown> | null;
}

// ─────────────────────────────────────────────
// Time helpers
// ─────────────────────────────────────────────

function daysSince(date: Date): number {
  return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
}

function isOverdue(item: ItemInput): boolean {
  if (!item.dueDate) return false;
  return new Date(item.dueDate).getTime() < Date.now();
}

function levelToSeverity(level: AlertLevel): string {
  if (level === "critical") return "critical";
  if (level === "warning") return "warning";
  return "info";
}

// ─────────────────────────────────────────────
// Rule Evaluators — produce AlertCandidates
// ─────────────────────────────────────────────

function evaluateCriticalItems(wf: WorkflowInput): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  const openItems = wf.items.filter((i) => i.status !== "completed");

  for (const item of openItems) {
    if (item.priority !== "critical") continue;
    const stage = wf.stages.find((s) => s.id === item.stageId);
    const daysOpen = daysSince(item.createdAt);

    candidates.push({
      ruleKey: `critical_item_${item.id}`,
      type: "risk_alert",
      category: "risk_alert",
      level: "critical",
      severity: "critical",
      title: `Critical item open: ${item.title}`,
      message: `Critical-priority item "${item.title}" is open in stage "${stage?.name ?? "unknown"}" of workflow "${wf.title}". Open for ${Math.round(daysOpen)} day${Math.round(daysOpen) !== 1 ? "s" : ""}.`,
      actionPath: `/workflows/${wf.id}`,
      workflowId: wf.id,
      linkedItemId: item.id,
      linkedStageId: item.stageId,
      metadata: {
        itemTitle: item.title,
        stageName: stage?.name,
        daysOpen: Math.round(daysOpen),
        priority: item.priority,
      },
    });
  }
  return candidates;
}

function evaluateOverdueItems(wf: WorkflowInput): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  const openItems = wf.items.filter((i) => i.status !== "completed");

  for (const item of openItems) {
    if (!isOverdue(item)) continue;
    const stage = wf.stages.find((s) => s.id === item.stageId);
    const overdueDays = Math.round((Date.now() - new Date(item.dueDate!).getTime()) / (1000 * 60 * 60 * 24));

    candidates.push({
      ruleKey: `overdue_item_${item.id}`,
      type: "timing_alert",
      category: "timing_alert",
      level: item.priority === "critical" || item.priority === "high" ? "critical" : "warning",
      severity: item.priority === "critical" || item.priority === "high" ? "critical" : "warning",
      title: `Item past due: ${item.title}`,
      message: `"${item.title}" in "${wf.title}" — ${stage?.name ?? "unknown stage"} is ${overdueDays} day${overdueDays !== 1 ? "s" : ""} overdue.`,
      actionPath: `/workflows/${wf.id}`,
      workflowId: wf.id,
      linkedItemId: item.id,
      linkedStageId: item.stageId,
      metadata: { overdueDays, dueDate: item.dueDate, priority: item.priority },
    });
  }
  return candidates;
}

function evaluateAgingItems(wf: WorkflowInput): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  const openItems = wf.items.filter((i) => i.status !== "completed");

  for (const item of openItems) {
    const daysInStage = daysSince(item.stageEnteredAt);

    if (daysInStage < ALERT_THRESHOLDS.ITEM_AGING_WARNING_DAYS) continue;
    if (isOverdue(item)) continue; // already covered by overdue alert

    const stage = wf.stages.find((s) => s.id === item.stageId);
    const level: AlertLevel = daysInStage >= ALERT_THRESHOLDS.ITEM_AGING_CRITICAL_DAYS ? "critical" : "warning";

    candidates.push({
      ruleKey: `aging_item_${item.id}`,
      type: "flow_alert",
      category: "flow_alert",
      level,
      severity: levelToSeverity(level),
      title: `Item aging in stage: ${item.title}`,
      message: `"${item.title}" has been in stage "${stage?.name ?? "unknown"}" for ${Math.round(daysInStage)} day${Math.round(daysInStage) !== 1 ? "s" : ""} without progression in "${wf.title}".`,
      actionPath: `/workflows/${wf.id}`,
      workflowId: wf.id,
      linkedItemId: item.id,
      linkedStageId: item.stageId,
      metadata: { daysInStage: Math.round(daysInStage), stageName: stage?.name, priority: item.priority },
    });
  }
  return candidates;
}

function evaluateBottleneck(wf: WorkflowInput): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  const openItems = wf.items.filter((i) => i.status !== "completed");
  if (openItems.length === 0) return candidates;

  // Find most congested stage
  const stageCounts = openItems.reduce((acc, i) => {
    acc[i.stageId] = (acc[i.stageId] ?? 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  for (const [stageIdStr, count] of Object.entries(stageCounts)) {
    if (count < ALERT_THRESHOLDS.BOTTLENECK_MIN_ITEMS) continue;
    const stageId = Number(stageIdStr);
    const stage = wf.stages.find((s) => s.id === stageId);
    const stageItems = openItems.filter((i) => i.stageId === stageId);
    const maxAgeDays = Math.round(Math.max(...stageItems.map((i) => daysSince(i.stageEnteredAt))));
    const level: AlertLevel = count >= 4 || maxAgeDays > 14 ? "critical" : "warning";
    const hasCritical = stageItems.some((i) => i.priority === "critical");

    candidates.push({
      ruleKey: `bottleneck_${wf.id}_${stageId}`,
      type: "flow_alert",
      category: "flow_alert",
      level: hasCritical ? "critical" : level,
      severity: levelToSeverity(hasCritical ? "critical" : level),
      title: `Bottleneck detected: ${stage?.name ?? "Stage"} in ${wf.title}`,
      message: `Stage "${stage?.name ?? "unknown"}" has ${count} open item${count !== 1 ? "s" : ""} concentrated in "${wf.title}". Oldest item aged ${maxAgeDays} day${maxAgeDays !== 1 ? "s" : ""}.`,
      actionPath: `/workflows/${wf.id}`,
      workflowId: wf.id,
      linkedItemId: null,
      linkedStageId: stageId,
      metadata: { stageId, stageName: stage?.name, itemCount: count, maxAgeDays, hasCritical },
    });
  }
  return candidates;
}

function evaluateWorkflowHealth(wf: WorkflowInput): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  const health = calcWorkflowHealth(wf);

  if (health.healthScore < ALERT_THRESHOLDS.WORKFLOW_HEALTH_RED) {
    candidates.push({
      ruleKey: `health_red_${wf.id}`,
      type: "status_alert",
      category: "status_alert",
      level: "critical",
      severity: "critical",
      title: `Workflow critical: ${wf.title}`,
      message: `"${wf.title}" health score dropped to ${health.healthScore}/100 (critical). ${health.insight}`,
      actionPath: `/workflows/${wf.id}`,
      workflowId: wf.id,
      linkedItemId: null,
      linkedStageId: null,
      metadata: {
        healthScore: health.healthScore,
        stoplight: health.stoplight,
        flowScore: health.flow.score,
        riskScore: health.risk.score,
      },
    });
  } else if (health.healthScore < ALERT_THRESHOLDS.WORKFLOW_HEALTH_YELLOW) {
    candidates.push({
      ruleKey: `health_yellow_${wf.id}`,
      type: "status_alert",
      category: "status_alert",
      level: "warning",
      severity: "warning",
      title: `Workflow needs attention: ${wf.title}`,
      message: `"${wf.title}" health score is ${health.healthScore}/100 (at risk). ${health.insight}`,
      actionPath: `/workflows/${wf.id}`,
      workflowId: wf.id,
      linkedItemId: null,
      linkedStageId: null,
      metadata: { healthScore: health.healthScore, stoplight: health.stoplight },
    });
  }

  return candidates;
}

function evaluateUnassignedCritical(wf: WorkflowInput): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  const openItems = wf.items.filter((i) => i.status !== "completed");

  for (const item of openItems) {
    if (item.priority !== "critical" && item.priority !== "high") continue;
    if (item.assignedTo && item.assignedTo.trim()) continue;

    const stage = wf.stages.find((s) => s.id === item.stageId);
    candidates.push({
      ruleKey: `unassigned_${item.id}`,
      type: "risk_alert",
      category: "risk_alert",
      level: item.priority === "critical" ? "critical" : "warning",
      severity: levelToSeverity(item.priority === "critical" ? "critical" : "warning"),
      title: `Unassigned ${item.priority}-priority item: ${item.title}`,
      message: `"${item.title}" (${item.priority} priority) in "${wf.title}" — stage "${stage?.name ?? "unknown"}" has no assigned owner.`,
      actionPath: `/workflows/${wf.id}`,
      workflowId: wf.id,
      linkedItemId: item.id,
      linkedStageId: item.stageId,
      metadata: { priority: item.priority, stageName: stage?.name },
    });
  }
  return candidates;
}

// ─────────────────────────────────────────────
// Rule 7: Critical Items Missing Documentation
// ─────────────────────────────────────────────

async function loadCriticalItemDocCounts(
  criticalItemIds: number[]
): Promise<Map<number, number>> {
  if (criticalItemIds.length === 0) return new Map();

  const docs = await db
    .select()
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.linkedEntityType, "workflow_item"),
        inArray(documentsTable.linkedEntityId, criticalItemIds)
      )
    );

  const counts = new Map<number, number>();
  for (const doc of docs) {
    const id = doc.linkedEntityId;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function evaluateMissingDocsCritical(
  wf: WorkflowInput,
  docCounts: Map<number, number>
): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  const openItems = wf.items.filter((i) => i.status !== "completed");

  for (const item of openItems) {
    if (item.priority !== "critical") continue;
    const count = docCounts.get(item.id) ?? 0;
    if (count > 0) continue; // Has docs — condition resolved

    const stage = wf.stages.find((s) => s.id === item.stageId);
    candidates.push({
      ruleKey: `missing_docs_critical_${item.id}`,
      type: "risk_alert",
      category: "risk_alert",
      level: "warning",
      severity: levelToSeverity("warning"),
      title: `Critical item missing documentation: ${item.title}`,
      message: `Critical-priority item "${item.title}" in "${wf.title}" — stage "${stage?.name ?? "unknown"}" has no supporting documents attached. Attach evidence to support decision-making.`,
      actionPath: `/workflows/${wf.id}`,
      workflowId: wf.id,
      linkedItemId: item.id,
      linkedStageId: item.stageId,
      metadata: { itemTitle: item.title, stageName: stage?.name, priority: item.priority },
    });
  }
  return candidates;
}

// ─────────────────────────────────────────────
// Asset Warranty Rule Evaluators
// ─────────────────────────────────────────────

type AssetRow = typeof assetsTable.$inferSelect;

function evaluateWarrantyExpired(assets: AssetRow[]): AlertCandidate[] {
  const today = new Date();
  return assets
    .filter((a) => a.warrantyExpiration && new Date(a.warrantyExpiration) < today)
    .map((a) => ({
      ruleKey: `warranty_expired_${a.id}`,
      type: "risk_alert",
      category: "risk_alert" as AlertCategory,
      level: "critical" as AlertLevel,
      severity: "critical",
      title: `Warranty expired: ${a.name}`,
      message: `The warranty for "${a.name}" (${a.location ?? "unknown location"}) expired on ${a.warrantyExpiration}. Asset is now operating without coverage — review for repair/replacement.`,
      actionPath: `/assets`,
      workflowId: null,
      linkedItemId: null,
      linkedStageId: null,
      metadata: {
        assetId: a.id,
        assetName: a.name,
        warrantyExpiration: a.warrantyExpiration,
        location: a.location,
        serial: a.serial,
      },
    }));
}

function evaluateWarrantyExpiringSoon(assets: AssetRow[]): AlertCandidate[] {
  const today = new Date();
  const ninetyDays = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
  return assets
    .filter((a) => {
      if (!a.warrantyExpiration) return false;
      const exp = new Date(a.warrantyExpiration);
      return exp >= today && exp <= ninetyDays;
    })
    .map((a) => {
      const daysLeft = Math.round(
        (new Date(a.warrantyExpiration!).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );
      return {
        ruleKey: `warranty_expiring_${a.id}`,
        type: "risk_alert",
        category: "risk_alert" as AlertCategory,
        level: "warning" as AlertLevel,
        severity: "warning",
        title: `Warranty expiring in ${daysLeft} days: ${a.name}`,
        message: `The warranty for "${a.name}" (${a.location ?? "unknown location"}) expires on ${a.warrantyExpiration} — ${daysLeft} days from now. Schedule inspection or renewal before coverage lapses.`,
        actionPath: `/assets`,
        workflowId: null,
        linkedItemId: null,
        linkedStageId: null,
        metadata: {
          assetId: a.id,
          assetName: a.name,
          warrantyExpiration: a.warrantyExpiration,
          daysRemaining: daysLeft,
          location: a.location,
          serial: a.serial,
        },
      };
    });
}

// ─────────────────────────────────────────────
// Active Rule Keys — which ruleKeys should be ACTIVE right now
// ─────────────────────────────────────────────

function collectActiveRuleKeys(candidates: AlertCandidate[]): Set<string> {
  return new Set(candidates.map((c) => c.ruleKey));
}

// ─────────────────────────────────────────────
// Main Evaluation Function
// ─────────────────────────────────────────────

export interface AlertEvaluationResult {
  created: number;
  updated: number;
  resolved: number;
  total: number;
}

export async function evaluateAlerts(): Promise<AlertEvaluationResult> {
  const [workflowInputs, allAssets] = await Promise.all([
    loadAllWorkflowInputs(),
    db.select().from(assetsTable),
  ]);
  const activeWorkflows = workflowInputs.filter((w) => w.status === "active" || w.status === "paused");

  // Pre-load doc counts for all critical open items (rule 7)
  const allCriticalItemIds = activeWorkflows.flatMap((wf) =>
    wf.items
      .filter((i) => i.status !== "completed" && i.priority === "critical")
      .map((i) => i.id)
  );
  const criticalItemDocCounts = await loadCriticalItemDocCounts(allCriticalItemIds);

  // Collect all candidates from all rule evaluators
  const allCandidates: AlertCandidate[] = [];
  for (const wf of activeWorkflows) {
    allCandidates.push(
      ...evaluateCriticalItems(wf),
      ...evaluateOverdueItems(wf),
      ...evaluateAgingItems(wf),
      ...evaluateBottleneck(wf),
      ...evaluateWorkflowHealth(wf),
      ...evaluateUnassignedCritical(wf),
      ...evaluateMissingDocsCritical(wf, criticalItemDocCounts)
    );
  }

  // Asset warranty rules (rules 8 & 9)
  allCandidates.push(
    ...evaluateWarrantyExpired(allAssets),
    ...evaluateWarrantyExpiringSoon(allAssets)
  );

  // Deduplicate candidates by ruleKey (keep highest level if same key from different evaluators)
  const candidateMap = new Map<string, AlertCandidate>();
  for (const candidate of allCandidates) {
    const existing = candidateMap.get(candidate.ruleKey);
    if (!existing || levelOrder(candidate.level) > levelOrder(existing.level)) {
      candidateMap.set(candidate.ruleKey, candidate);
    }
  }

  const uniqueCandidates = Array.from(candidateMap.values());
  const activeRuleKeys = collectActiveRuleKeys(uniqueCandidates);

  // Load all current active alerts from DB
  const existingAlerts = await db
    .select()
    .from(alertsTable)
    .then((rows) => rows.filter((a) => a.isActive));

  const existingByRuleKey = new Map(
    existingAlerts.filter((a) => a.ruleKey).map((a) => [a.ruleKey!, a])
  );

  let created = 0;
  let updated = 0;
  let resolved = 0;

  const now = new Date();

  // Upsert: create new alerts or update lastSeenAt for existing ones
  for (const candidate of uniqueCandidates) {
    const existing = existingByRuleKey.get(candidate.ruleKey);

    if (existing) {
      // Update lastSeenAt and refresh content if level changed
      await db
        .update(alertsTable)
        .set({
          lastSeenAt: now,
          title: candidate.title,
          message: candidate.message,
          level: candidate.level,
          severity: candidate.severity,
          metadata: candidate.metadata as any,
        })
        .where(eq(alertsTable.id, existing.id));
      updated++;
    } else {
      // Create new alert
      await db.insert(alertsTable).values({
        ruleKey: candidate.ruleKey,
        type: candidate.type,
        category: candidate.category,
        level: candidate.level,
        severity: candidate.severity,
        title: candidate.title,
        message: candidate.message,
        actionPath: candidate.actionPath,
        workflowId: candidate.workflowId,
        linkedItemId: candidate.linkedItemId,
        linkedStageId: candidate.linkedStageId,
        metadata: candidate.metadata as any,
        status: "active",
        isActive: true,
        isRead: false,
        triggeredAt: now,
        lastSeenAt: now,
      });
      created++;
    }
  }

  // Resolve alerts whose condition no longer holds
  for (const alert of existingAlerts) {
    if (!alert.ruleKey) continue;
    if (activeRuleKeys.has(alert.ruleKey)) continue;
    if (alert.status === "resolved") continue;

    await db
      .update(alertsTable)
      .set({
        status: "resolved",
        isActive: false,
        resolvedAt: now,
      })
      .where(eq(alertsTable.id, alert.id));
    resolved++;
  }

  return { created, updated, resolved, total: uniqueCandidates.size };
}

// ─────────────────────────────────────────────
// Helper: order levels for comparison
// ─────────────────────────────────────────────

function levelOrder(level: AlertLevel): number {
  if (level === "critical") return 3;
  if (level === "warning") return 2;
  return 1;
}

// ─────────────────────────────────────────────
// Alert Summary — counts by level and status
// ─────────────────────────────────────────────

export interface AlertSummary {
  total: number;
  active: number;
  critical: number;
  warning: number;
  informational: number;
  unread: number;
}

export async function getAlertSummary(): Promise<AlertSummary> {
  const alerts = await db.select().from(alertsTable);
  const active = alerts.filter((a) => a.isActive);
  return {
    total: alerts.length,
    active: active.length,
    critical: active.filter((a) => a.level === "critical").length,
    warning: active.filter((a) => a.level === "warning").length,
    informational: active.filter((a) => a.level === "informational").length,
    unread: alerts.filter((a) => !a.isRead).length,
  };
}
