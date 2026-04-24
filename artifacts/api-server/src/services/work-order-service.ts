/**
 * Build 2.5 — Work Order Service (Extended: Turn + Bottleneck Layer)
 *
 * Handles:
 * - Field normalization from CSV rows (including bottleneck/turn fields)
 * - SLA computation
 * - Fuzzy property matching + auto-creation of missing properties
 * - Unit matching within matched properties
 * - System "Work Orders" workflow provisioning
 * - Workflow item creation per work order
 * - Category + bottleneck intelligence aggregation
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
import { eq, and, sql, inArray, ne, desc } from "drizzle-orm";
import type { WorkOrder, InsertWorkOrder } from "@workspace/db/schema";
import {
  isWoSlaViolation,
  isWoAging,
  isWoBlocked,
  isWorkOrderReportable,
} from "./operational-selectors";

// ─── SLA defaults ─────────────────────────────────────────────────────────────

export const DEFAULT_SLA_HOURS = 24;

// ─── Work Orders system workflow title ────────────────────────────────────────

export const WO_WORKFLOW_TITLE = "Work Orders";
export const WO_STAGE_NAMES = ["Submitted", "Assigned", "In Progress", "Completed"] as const;

// ─── CSV column aliases ───────────────────────────────────────────────────────

const COLUMN_ALIASES: Record<string, string[]> = {
  work_order_id:       ["work_order_id", "wo_id", "id", "order_id", "ticket_id", "wo#", "wo number", "work order id"],
  property_name:       ["property_name", "property", "building", "site", "complex"],
  unit_number:         ["unit_number", "unit", "apt", "apartment", "unit_no", "unit no", "apt number"],
  category:            ["category", "type", "issue_type", "work_type", "work type", "issue type"],
  description:         ["description", "desc", "details", "summary", "problem", "issue"],
  priority:            ["priority", "urgency", "severity"],
  status:              ["status", "state", "wo_status"],
  assigned_to:         ["assigned_to", "assignee", "technician", "tech", "assigned tech"],
  notes:               ["notes", "note", "comment", "comments", "internal_notes"],
  region_name:         ["region_name", "region", "district", "area"],
  turn_id:             ["turn_id", "turn", "turn_number", "turn_ref"],
  created_date:        ["created_date", "created_at", "date_created", "submitted_date", "open_date", "date", "created", "submitted"],
  scheduled_date:      ["scheduled_date", "scheduled_at", "schedule_date", "planned_date"],
  first_response_date: ["first_response_date", "response_date", "responded_at", "assigned_date", "assigned_at"],
  completed_date:      ["completed_date", "closed_date", "completion_date", "resolved_date", "resolved_at", "closed_at"],
  estimated_hours:     ["estimated_hours", "est_hours", "hours_estimated", "estimated_labor"],
  actual_hours:        ["actual_hours", "act_hours", "hours_actual", "actual_labor", "hours_worked"],
  stage:               ["stage", "current_stage", "turn_stage", "stage_name"],
  stage_status:        ["stage_status", "stage_state", "stage_progress"],
  days_in_stage:       ["days_in_stage", "stage_age", "days_in_current_stage", "stage_days"],
  is_blocked:          ["is_blocked", "blocked", "blocked_flag", "is_stuck"],
  delay_reason:        ["delay_reason", "block_reason", "reason_for_delay", "delay_cause"],
  vendor:              ["vendor", "vendor_name", "contractor", "service_vendor"],
  bottleneck_flag:     ["bottleneck_flag", "is_bottleneck", "bottleneck"],
  bottleneck_type:     ["bottleneck_type", "bottleneck_category", "block_type"],
  aggregation_scope:   ["aggregation_scope", "scope", "roll_up_scope"],
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

// ─── Boolean parsing ──────────────────────────────────────────────────────────

export function parseBool(val?: string): boolean {
  if (!val) return false;
  const v = val.toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes";
}

// ─── Number parsing ───────────────────────────────────────────────────────────

export function parseFloat2(val?: string): number | null {
  if (!val || val.trim() === "") return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

export function parseInt2(val?: string): number | null {
  if (!val || val.trim() === "") return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
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
  if (v.includes("in_progress") || v.includes("inprogress") || v.includes("progress") || v.includes("wip")) return "in_progress";
  if (v.includes("assign")) return "assigned";
  if (v.includes("cancel")) return "cancelled";
  // "open" and "submitted" → submitted (not in_progress)
  return "submitted";
}

// ─── Category normalization ───────────────────────────────────────────────────
// Preserves turn-specific categories (Turn, Cleaning, Inspection, etc.)
// while still normalizing standard maintenance categories

const TURN_CATEGORIES = new Set([
  "turn", "cleaning", "inspection", "rework", "paint", "paint prep",
  "trash out", "flooring", "maintenance", "general",
]);

export function normalizeCategory(val?: string): string {
  if (!val) return "General";
  const v = val.toLowerCase().trim();
  // Preserve exact turn-workflow categories
  if (TURN_CATEGORIES.has(v)) return val.trim();
  // Standard maintenance normalization
  if (v.includes("hvac") || v.includes("air") || v.includes("heat") || v.includes("cool")) return "HVAC";
  if (v.includes("plumb") || v.includes("leak") || v.includes("drain") || v.includes("toilet") || v.includes("sink") || v.includes("water")) return "Plumbing";
  if (v.includes("electric") || v.includes("outlet") || v.includes("light") || v.includes("breaker")) return "Electrical";
  if (v.includes("appliance") || v.includes("stove") || v.includes("oven") || v.includes("washer") || v.includes("dryer") || v.includes("dishwasher") || v.includes("refrigerator") || v.includes("fridge")) return "Appliance";
  if (v.includes("paint") || v.includes("drywall") || v.includes("wall")) return "Paint / Drywall";
  if (v.includes("floor") || v.includes("carpet") || v.includes("tile")) return "Flooring";
  if (v.includes("window") || v.includes("door") || v.includes("lock")) return "Windows / Doors";
  if (v.includes("pest") || v.includes("bug") || v.includes("rodent")) return "Pest Control";
  if (v.includes("trash") || v.includes("clean")) return "Cleaning";
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

// ─── Fuzzy property matching ──────────────────────────────────────────────────

export interface PropertyMatchResult {
  propertyId: number | null;
  confidence: "exact" | "fuzzy" | "created" | "none";
}

export async function resolveProperty(
  propertyNameRaw: string | undefined
): Promise<PropertyMatchResult> {
  if (!propertyNameRaw?.trim()) return { propertyId: null, confidence: "none" };

  const needle = propertyNameRaw.trim().toLowerCase();
  const allProperties = await db.select({ id: propertiesTable.id, name: propertiesTable.name })
    .from(propertiesTable);

  // Exact match
  const exact = allProperties.find(p => p.name.toLowerCase() === needle);
  if (exact) return { propertyId: exact.id, confidence: "exact" };

  // Contains match (bidirectional)
  const fuzzy = allProperties.find(p => {
    const pn = p.name.toLowerCase();
    return pn.includes(needle) || needle.includes(pn);
  });
  if (fuzzy) return { propertyId: fuzzy.id, confidence: "fuzzy" };

  // Create new property
  const [created] = await db.insert(propertiesTable).values({
    name: propertyNameRaw.trim(),
    address: "",
    city: "",
    state: "",
    zip: "",
    propertyType: "multifamily",
  }).returning();

  return { propertyId: created.id, confidence: "created" };
}

// ─── Unit matching within a property ─────────────────────────────────────────

export async function resolveUnit(
  unitNumberRaw: string | undefined,
  propertyId: number | null
): Promise<number | null> {
  if (!unitNumberRaw?.trim() || !propertyId) return null;

  const needle = unitNumberRaw.trim();
  const units = await db.select({ id: unitsTable.id, unitNumber: unitsTable.unitNumber })
    .from(unitsTable)
    .where(eq(unitsTable.propertyId, propertyId));

  // Exact match
  const exact = units.find(u => u.unitNumber === needle);
  if (exact) return exact.id;

  // Numeric-normalized match (e.g. "101" matches "101", "Apt 101" → "101")
  const numericNeedle = needle.replace(/[^0-9]/g, "");
  if (numericNeedle) {
    const numMatch = units.find(u => (u.unitNumber ?? "").replace(/[^0-9]/g, "") === numericNeedle);
    if (numMatch) return numMatch.id;
  }

  return null;
}

// ─── System workflow provisioning ─────────────────────────────────────────────

export interface WorkOrdersWorkflow {
  workflowId: number;
  stages: { id: number; name: string; order: number }[];
}

export async function getOrCreateWorkOrdersWorkflow(): Promise<WorkOrdersWorkflow> {
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

    const unitLabel = wo.unitNumberRaw ? `Unit ${wo.unitNumberRaw}` : null;
    const propertyLabel = wo.propertyNameRaw ?? null;
    const locationLabel = [unitLabel, propertyLabel].filter(Boolean).join(" — ");

    const title = [wo.category, wo.externalId ? `#${wo.externalId}` : null, locationLabel]
      .filter(Boolean)
      .join(" · ") || wo.description?.slice(0, 60) || "Work Order";

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

    await db.insert(workflowItemHistoryTable).values({
      itemId: item.id,
      fromStageId: null,
      toStageId: submittedStage.id,
      movedAt: wo.createdDate ?? new Date(),
      notes: "Imported from work order",
    });

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
  blockedCount: number;
}

// ─── Bottleneck intelligence ──────────────────────────────────────────────────

export interface StageCongestion {
  stage: string;
  blockedCount: number;
  avgDaysInStage: number;
  properties: string[];
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
  blockedCount: number;
  blockedTurnCount: number;
  topCategory: string | null;
  topBottleneckStage: string | null;
  topBottleneckType: string | null;
  categories: CategoryStat[];
  stageCongestion: StageCongestion[];
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
      propertyId: workOrdersTable.propertyId,
      stage: workOrdersTable.stage,
      daysInStage: workOrdersTable.daysInStage,
      isBlocked: workOrdersTable.isBlocked,
      bottleneckFlag: workOrdersTable.bottleneckFlag,
      bottleneckType: workOrdersTable.bottleneckType,
      turnId: workOrdersTable.turnId,
      propertyNameRaw: workOrdersTable.propertyNameRaw,
      // Ascent 1.12.7 — required by isWorkOrderReportable confidence filter.
      availableForPropertyRollup: workOrdersTable.availableForPropertyRollup,
      availableForUnitRollup: workOrdersTable.availableForUnitRollup,
    })
    .from(workOrdersTable);

  // Use shared selectors so headline counts MUST match drill / list endpoints.
  // (Symmetry rule — Ascent 1.12.6 governance lock.)
  const total = all.length;
  const open = all.filter(w => w.status !== "completed" && w.status !== "cancelled").length;
  const completed = all.filter(w => w.status === "completed").length;
  const slaMetCount = all.filter(w => w.slaStatus === "met").length;
  // Ascent 1.12.7 — apply default confidence filter so tile counts match
  // drill / list / audit. Every locked-metric count below is computed over
  // the `reportable` subset; raw counts (total/open/completed/slaMet/pending)
  // remain unfiltered for honest dataset reporting.
  const reportable = all.filter(w => isWorkOrderReportable(w));
  const slaMissedCount = reportable.filter(isWoSlaViolation).length;
  const slaPendingCount = all.filter(w => w.slaStatus === "pending").length;

  const agingCount = reportable.filter(isWoAging).length;

  // Blocked counts (also confidence-gated)
  const blockedCount = reportable.filter(isWoBlocked).length;
  const blockedTurnCount = reportable.filter(w => isWoBlocked(w) && w.turnId).length;

  const slaComplianceRate = total > 0
    ? Math.round((slaMetCount / (slaMetCount + slaMissedCount || 1)) * 100)
    : 100;

  // Category breakdown — same confidence gate, so per-category violation
  // counts roll up to the same locked totals as the headline tiles.
  const catMap = new Map<string, { count: number; violations: number; responseTimes: number[]; units: number[]; blocked: number }>();
  for (const wo of reportable) {
    const cat = wo.category ?? "General";
    if (!catMap.has(cat)) catMap.set(cat, { count: 0, violations: 0, responseTimes: [], units: [], blocked: 0 });
    const entry = catMap.get(cat)!;
    entry.count++;
    if (isWoSlaViolation(wo)) entry.violations++;
    if (wo.slaResponseDelayHours != null) entry.responseTimes.push(wo.slaResponseDelayHours);
    if (wo.unitId) entry.units.push(wo.unitId);
    if (wo.isBlocked) entry.blocked++;
  }

  const categories: CategoryStat[] = Array.from(catMap.entries())
    .map(([category, stat]) => ({
      category,
      count: stat.count,
      slaViolations: stat.violations,
      avgResponseHours: stat.responseTimes.length > 0
        ? +(stat.responseTimes.reduce((a, b) => a + b, 0) / stat.responseTimes.length).toFixed(1)
        : null,
      topUnit: null,
      blockedCount: stat.blocked,
    }))
    .sort((a, b) => b.count - a.count);

  const topCategory = categories[0]?.category ?? null;

  // Stage congestion analysis
  const stageMap = new Map<string, { count: number; days: number[]; properties: Set<string> }>();
  for (const wo of all) {
    if (!wo.stage || wo.status === "completed" || !wo.isBlocked) continue;
    if (!stageMap.has(wo.stage)) stageMap.set(wo.stage, { count: 0, days: [], properties: new Set() });
    const entry = stageMap.get(wo.stage)!;
    entry.count++;
    if (wo.daysInStage != null) entry.days.push(wo.daysInStage);
    if (wo.propertyNameRaw) entry.properties.add(wo.propertyNameRaw);
  }

  const stageCongestion: StageCongestion[] = Array.from(stageMap.entries())
    .map(([stage, stat]) => ({
      stage,
      blockedCount: stat.count,
      avgDaysInStage: stat.days.length > 0
        ? +(stat.days.reduce((a, b) => a + b, 0) / stat.days.length).toFixed(1)
        : 0,
      properties: Array.from(stat.properties),
    }))
    .sort((a, b) => b.blockedCount - a.blockedCount);

  const topBottleneckStage = stageCongestion[0]?.stage ?? null;

  // Top bottleneck type
  const typeMap = new Map<string, number>();
  for (const wo of all) {
    if (wo.bottleneckType && wo.bottleneckType !== "none" && wo.status !== "completed") {
      typeMap.set(wo.bottleneckType, (typeMap.get(wo.bottleneckType) ?? 0) + 1);
    }
  }
  const topBottleneckType = typeMap.size > 0
    ? Array.from(typeMap.entries()).sort((a, b) => b[1] - a[1])[0][0]
    : null;

  return {
    total,
    open,
    completed,
    slaMetCount,
    slaMissedCount,
    slaPendingCount,
    slaComplianceRate,
    agingCount,
    blockedCount,
    blockedTurnCount,
    topCategory,
    topBottleneckStage,
    topBottleneckType,
    categories,
    stageCongestion,
  };
}
