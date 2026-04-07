/**
 * Build 2.5 — Work Order Service
 *
 * Handles:
 * - Field normalization from CSV rows
 * - SLA computation
 * - System "Work Orders" workflow provisioning
 * - Workflow item creation per work order
 * - Category intelligence aggregation
 */

import { db } from "@workspace/db";
import {
  workOrdersTable,
  workflowsTable,
  stagesTable,
  workflowItemsTable,
  workflowItemHistoryTable,
  unitsTable,
  propertiesTable,
} from "@workspace/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import type { WorkOrder, InsertWorkOrder } from "@workspace/db/schema";

// ─── SLA defaults ─────────────────────────────────────────────────────────────

export const DEFAULT_SLA_HOURS = 24;

// ─── Work Orders system workflow title ────────────────────────────────────────

export const WO_WORKFLOW_TITLE = "Work Orders";
export const WO_STAGE_NAMES = ["Submitted", "Assigned", "In Progress", "Completed"] as const;

// ─── CSV column aliases ───────────────────────────────────────────────────────

const COLUMN_ALIASES: Record<string, string[]> = {
  work_order_id: ["work_order_id", "wo_id", "id", "order_id", "ticket_id", "wo#", "wo number", "work order id"],
  property_name:  ["property_name", "property", "building", "site", "complex"],
  unit_number:    ["unit_number", "unit", "apt", "apartment", "unit_no", "unit no", "apt number"],
  category:       ["category", "type", "issue_type", "work_type", "work type", "issue type"],
  description:    ["description", "desc", "notes", "details", "summary", "problem", "issue"],
  priority:       ["priority", "urgency", "severity"],
  created_date:   ["created_date", "created_at", "date_created", "submitted_date", "open_date", "date", "created", "submitted"],
  first_response_date: ["first_response_date", "response_date", "responded_at", "assigned_date", "assigned_at"],
  completed_date: ["completed_date", "closed_date", "completion_date", "resolved_date", "resolved_at", "closed_at"],
  status:         ["status", "state", "wo_status"],
};

// ─── Field extraction ─────────────────────────────────────────────────────────

export function extractField(row: Record<string, string>, field: string): string | undefined {
  const aliases = COLUMN_ALIASES[field] ?? [field];
  for (const alias of aliases) {
    const lower = alias.toLowerCase();
    const found = Object.keys(row).find(k => k.toLowerCase().trim() === lower);
    if (found && row[found]?.trim()) return row[found].trim();
  }
  return undefined;
}

// ─── Date parsing ─────────────────────────────────────────────────────────────

export function parseDate(val?: string): Date | null {
  if (!val || val.trim() === "" || val.trim().toLowerCase() === "n/a") return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Priority normalization ───────────────────────────────────────────────────

export function normalizePriority(val?: string): "low" | "medium" | "high" | "critical" {
  const v = (val ?? "").toLowerCase();
  if (v.includes("critical") || v === "p1" || v === "1") return "critical";
  if (v.includes("high") || v === "p2" || v === "2") return "high";
  if (v.includes("low") || v === "p4" || v === "4") return "low";
  return "medium";
}

// ─── Status normalization ─────────────────────────────────────────────────────

export function normalizeStatus(val?: string): WorkOrder["status"] {
  const v = (val ?? "").toLowerCase().replace(/[\s_-]+/g, "_");
  if (v.includes("complet") || v.includes("closed") || v.includes("done") || v.includes("resolv")) return "completed";
  if (v.includes("in_progress") || v.includes("inprogress") || v.includes("progress") || v.includes("wip") || v.includes("open")) return "in_progress";
  if (v.includes("assign")) return "assigned";
  if (v.includes("cancel")) return "cancelled";
  return "submitted";
}

// ─── Category normalization ───────────────────────────────────────────────────

export function normalizeCategory(val?: string): string {
  if (!val) return "general";
  const v = val.toLowerCase().trim();
  if (v.includes("refrigerator") || v.includes("fridge")) return "Refrigerator";
  if (v.includes("hvac") || v.includes("air") || v.includes("heat") || v.includes("cool")) return "HVAC";
  if (v.includes("plumb") || v.includes("leak") || v.includes("drain") || v.includes("toilet") || v.includes("sink") || v.includes("water")) return "Plumbing";
  if (v.includes("electric") || v.includes("outlet") || v.includes("light") || v.includes("breaker")) return "Electrical";
  if (v.includes("appliance") || v.includes("stove") || v.includes("oven") || v.includes("washer") || v.includes("dryer") || v.includes("dishwasher")) return "Appliance";
  if (v.includes("paint") || v.includes("drywall") || v.includes("wall")) return "Paint / Drywall";
  if (v.includes("floor") || v.includes("carpet") || v.includes("tile")) return "Flooring";
  if (v.includes("window") || v.includes("door") || v.includes("lock")) return "Windows / Doors";
  if (v.includes("pest") || v.includes("bug") || v.includes("rodent")) return "Pest Control";
  if (v.includes("trash") || v.includes("clean")) return "Cleaning / Trash";
  if (v.includes("structural") || v.includes("roof")) return "Structural";
  return val.trim() || "General";
}

// ─── SLA computation ──────────────────────────────────────────────────────────

export interface SlaResult {
  status: "pending" | "met" | "missed";
  delayHours: number | null;
}

export function computeSla(
  createdDate: Date | null,
  firstResponseDate: Date | null,
  deadlineHours = DEFAULT_SLA_HOURS
): SlaResult {
  if (!createdDate) return { status: "pending", delayHours: null };
  if (!firstResponseDate) {
    // No response yet — check if deadline has passed
    const hoursSinceCreated = (Date.now() - createdDate.getTime()) / 3_600_000;
    if (hoursSinceCreated > deadlineHours) {
      return { status: "missed", delayHours: +(hoursSinceCreated - deadlineHours).toFixed(2) };
    }
    return { status: "pending", delayHours: null };
  }
  const responseHours = (firstResponseDate.getTime() - createdDate.getTime()) / 3_600_000;
  if (responseHours <= deadlineHours) {
    return { status: "met", delayHours: null };
  }
  return { status: "missed", delayHours: +(responseHours - deadlineHours).toFixed(2) };
}

// ─── System workflow provisioning ─────────────────────────────────────────────

export interface WorkOrdersWorkflow {
  workflowId: number;
  stages: { id: number; name: string; order: number }[];
}

export async function getOrCreateWorkOrdersWorkflow(): Promise<WorkOrdersWorkflow> {
  // Find existing system workflow
  const existing = await db
    .select()
    .from(workflowsTable)
    .where(eq(workflowsTable.title, WO_WORKFLOW_TITLE));

  let workflowId: number;

  if (existing.length > 0) {
    workflowId = existing[0].id;
  } else {
    const [created] = await db
      .insert(workflowsTable)
      .values({
        title: WO_WORKFLOW_TITLE,
        description: "System-managed work order tracking workflow",
        status: "active",
        stoplight: "green",
        flowScore: 80,
        riskScore: 80,
        improvementScore: 80,
        executionScore: 80,
        healthScore: 80,
      })
      .returning();
    workflowId = created.id;
  }

  // Load existing stages
  const existingStages = await db
    .select()
    .from(stagesTable)
    .where(eq(stagesTable.workflowId, workflowId));

  if (existingStages.length >= WO_STAGE_NAMES.length) {
    return {
      workflowId,
      stages: existingStages
        .sort((a, b) => a.order - b.order)
        .map(s => ({ id: s.id, name: s.name, order: s.order })),
    };
  }

  // Create missing stages
  const existingNames = new Set(existingStages.map(s => s.name));
  const toCreate = WO_STAGE_NAMES
    .map((name, i) => ({ name, order: i + 1 }))
    .filter(s => !existingNames.has(s.name));

  if (toCreate.length > 0) {
    await db.insert(stagesTable).values(
      toCreate.map(s => ({ workflowId, name: s.name, order: s.order, status: "active" }))
    );
  }

  const allStages = await db
    .select()
    .from(stagesTable)
    .where(eq(stagesTable.workflowId, workflowId));

  return {
    workflowId,
    stages: allStages
      .sort((a, b) => a.order - b.order)
      .map(s => ({ id: s.id, name: s.name, order: s.order })),
  };
}

// ─── Determine target stage for a work order ──────────────────────────────────

function determineStage(
  status: string,
  stages: WorkOrdersWorkflow["stages"]
): { id: number; name: string } {
  const byName = (name: string) => stages.find(s => s.name === name) ?? stages[0];
  switch (status) {
    case "completed": return byName("Completed");
    case "in_progress": return byName("In Progress");
    case "assigned": return byName("Assigned");
    default: return byName("Submitted");
  }
}

// ─── Create workflow item for a work order ────────────────────────────────────

export async function createWorkflowItemForWorkOrder(
  wo: WorkOrder,
  wfData: WorkOrdersWorkflow
): Promise<number | null> {
  try {
    const targetStage = determineStage(wo.status, wfData.stages);
    const submittedStage = wfData.stages.find(s => s.name === "Submitted") ?? wfData.stages[0];

    const priorityMap: Record<string, string> = { critical: "critical", high: "high", low: "low", medium: "medium" };
    const priority = priorityMap[wo.priority] ?? "medium";

    const title = [wo.category, wo.externalId ? `#${wo.externalId}` : null]
      .filter(Boolean)
      .join(" — ") || wo.description?.slice(0, 60) || "Work Order";

    const [item] = await db
      .insert(workflowItemsTable)
      .values({
        workflowId: wfData.workflowId,
        stageId: targetStage.id,
        title,
        description: wo.description ?? undefined,
        priority,
        status: wo.status === "completed" ? "completed" : "open",
        stageEnteredAt: wo.createdDate ?? new Date(),
      })
      .returning();

    // Create history: submitted entry
    await db.insert(workflowItemHistoryTable).values({
      itemId: item.id,
      fromStageId: null,
      toStageId: submittedStage.id,
      movedAt: wo.createdDate ?? new Date(),
      notes: "Imported from work order",
    });

    // If status advanced past submitted, add movement records
    if (wo.status !== "submitted" && wo.firstResponseDate) {
      const assignedStage = wfData.stages.find(s => s.name === "Assigned");
      if (assignedStage) {
        await db.insert(workflowItemHistoryTable).values({
          itemId: item.id,
          fromStageId: submittedStage.id,
          toStageId: assignedStage.id,
          movedAt: wo.firstResponseDate,
          notes: "First response recorded",
        });
      }
    }

    if ((wo.status === "in_progress" || wo.status === "completed") && wo.firstResponseDate) {
      const inProgressStage = wfData.stages.find(s => s.name === "In Progress");
      const assignedStage = wfData.stages.find(s => s.name === "Assigned");
      if (inProgressStage && assignedStage) {
        await db.insert(workflowItemHistoryTable).values({
          itemId: item.id,
          fromStageId: assignedStage.id,
          toStageId: inProgressStage.id,
          movedAt: new Date(wo.firstResponseDate.getTime() + 60_000),
          notes: "Work in progress",
        });
      }
    }

    if (wo.status === "completed" && wo.completedDate) {
      const completedStage = wfData.stages.find(s => s.name === "Completed");
      const inProgressStage = wfData.stages.find(s => s.name === "In Progress");
      if (completedStage && inProgressStage) {
        await db.insert(workflowItemHistoryTable).values({
          itemId: item.id,
          fromStageId: inProgressStage.id,
          toStageId: completedStage.id,
          movedAt: wo.completedDate,
          notes: "Work order completed",
        });
      }
    }

    return item.id;
  } catch {
    return null;
  }
}

// ─── Category intelligence ────────────────────────────────────────────────────

export interface CategoryStat {
  category: string;
  count: number;
  slaViolations: number;
  avgResponseHours: number | null;
  topUnit: string | null;
}

export interface WorkOrderStats {
  total: number;
  open: number;
  completed: number;
  slaMetCount: number;
  slaMissedCount: number;
  slaPendingCount: number;
  slaComplianceRate: number;
  agingCount: number;
  topCategory: string | null;
  categories: CategoryStat[];
}

export async function getWorkOrderStats(): Promise<WorkOrderStats> {
  const all = await db
    .select({
      id: workOrdersTable.id,
      status: workOrdersTable.status,
      category: workOrdersTable.category,
      slaStatus: workOrdersTable.slaStatus,
      slaResponseDelayHours: workOrdersTable.slaResponseDelayHours,
      createdDate: workOrdersTable.createdDate,
      unitId: workOrdersTable.unitId,
    })
    .from(workOrdersTable);

  const total = all.length;
  const open = all.filter(w => w.status !== "completed" && w.status !== "cancelled").length;
  const completed = all.filter(w => w.status === "completed").length;
  const slaMetCount = all.filter(w => w.slaStatus === "met").length;
  const slaMissedCount = all.filter(w => w.slaStatus === "missed").length;
  const slaPendingCount = all.filter(w => w.slaStatus === "pending").length;

  const AGING_DAYS = 7;
  const agingThreshold = new Date(Date.now() - AGING_DAYS * 86_400_000);
  const agingCount = all.filter(
    w => w.status === "in_progress" && w.createdDate && w.createdDate < agingThreshold
  ).length;

  const slaComplianceRate = total > 0
    ? Math.round((slaMetCount / (slaMetCount + slaMissedCount || 1)) * 100)
    : 100;

  // Category breakdown
  const catMap = new Map<string, { count: number; violations: number; responseTimes: number[]; units: number[] }>();
  for (const wo of all) {
    const cat = wo.category ?? "General";
    if (!catMap.has(cat)) catMap.set(cat, { count: 0, violations: 0, responseTimes: [], units: [] });
    const entry = catMap.get(cat)!;
    entry.count++;
    if (wo.slaStatus === "missed") entry.violations++;
    if (wo.slaResponseDelayHours != null) entry.responseTimes.push(wo.slaResponseDelayHours);
    if (wo.unitId) entry.units.push(wo.unitId);
  }

  const categories: CategoryStat[] = Array.from(catMap.entries())
    .map(([category, stat]) => ({
      category,
      count: stat.count,
      slaViolations: stat.violations,
      avgResponseHours: stat.responseTimes.length > 0
        ? +(stat.responseTimes.reduce((a, b) => a + b, 0) / stat.responseTimes.length).toFixed(1)
        : null,
      topUnit: null, // enriched separately if needed
    }))
    .sort((a, b) => b.count - a.count);

  const topCategory = categories[0]?.category ?? null;

  return {
    total,
    open,
    completed,
    slaMetCount,
    slaMissedCount,
    slaPendingCount,
    slaComplianceRate,
    agingCount,
    topCategory,
    categories,
  };
}
