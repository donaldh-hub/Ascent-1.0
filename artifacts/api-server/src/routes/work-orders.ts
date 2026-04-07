/**
 * Build 2.5 — Work Order Routes (Extended: Turn + Bottleneck Layer)
 *
 * POST /api/work-orders/reset         — clear all work-order + associated workflow data
 * POST /api/work-orders/import        — CSV row ingestion (all bottleneck fields preserved)
 * GET  /api/work-orders               — list with filters
 * GET  /api/work-orders/stats         — aggregate stats (includes bottleneck intelligence)
 * GET  /api/work-orders/categories    — category breakdown
 * GET  /api/work-orders/:id           — detail view
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  workOrdersTable,
  unitsTable,
  propertiesTable,
  workflowItemsTable,
  workflowItemHistoryTable,
  workflowsTable,
  stagesTable,
} from "@workspace/db/schema";
import { eq, and, or, inArray, desc, ne } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  extractField,
  parseDate,
  parseBool,
  parseFloat2,
  parseInt2,
  normalizePriority,
  normalizeStatus,
  normalizeCategory,
  computeSla,
  DEFAULT_SLA_HOURS,
  getOrCreateWorkOrdersWorkflow,
  createWorkflowItemForWorkOrder,
  getWorkOrderStats,
  resolveProperty,
  resolveUnit,
  WO_WORKFLOW_TITLE,
} from "../services/work-order-service";

const router = Router();

// ─── Enrich work orders with unit/property names ──────────────────────────────

async function enrichWorkOrders(wos: (typeof workOrdersTable.$inferSelect)[]) {
  if (wos.length === 0) return wos;

  const unitIds = [...new Set(wos.map(w => w.unitId).filter(Boolean))] as number[];
  const propertyIds = [...new Set(wos.map(w => w.propertyId).filter(Boolean))] as number[];

  const units = unitIds.length
    ? await db.select({ id: unitsTable.id, unitNumber: unitsTable.unitNumber, propertyId: unitsTable.propertyId })
        .from(unitsTable).where(inArray(unitsTable.id, unitIds))
    : [];
  const properties = propertyIds.length
    ? await db.select({ id: propertiesTable.id, name: propertiesTable.name })
        .from(propertiesTable).where(inArray(propertiesTable.id, propertyIds))
    : [];

  const unitMap = new Map(units.map(u => [u.id, u]));
  const propMap = new Map(properties.map(p => [p.id, p.name]));

  return wos.map(wo => ({
    ...wo,
    unitNumber: wo.unitId ? (unitMap.get(wo.unitId)?.unitNumber ?? null) : wo.unitNumberRaw ?? null,
    propertyName: wo.propertyId ? (propMap.get(wo.propertyId) ?? null) : wo.propertyNameRaw ?? null,
    createdDate: wo.createdDate?.toISOString() ?? null,
    scheduledDate: wo.scheduledDate?.toISOString() ?? null,
    firstResponseDate: wo.firstResponseDate?.toISOString() ?? null,
    completedDate: wo.completedDate?.toISOString() ?? null,
    importedAt: wo.importedAt.toISOString(),
    updatedAt: wo.updatedAt.toISOString(),
  }));
}

// ─── POST /api/work-orders/reset ──────────────────────────────────────────────

router.post("/work-orders/reset", async (req, res) => {
  try {
    // Find the Work Orders workflow
    const [wfRow] = await db
      .select({ id: workflowsTable.id })
      .from(workflowsTable)
      .where(eq(workflowsTable.title, WO_WORKFLOW_TITLE));

    let deletedWorkflowItems = 0;
    let deletedHistoryRows = 0;

    if (wfRow) {
      // Get all workflow items in that workflow
      const items = await db
        .select({ id: workflowItemsTable.id })
        .from(workflowItemsTable)
        .where(eq(workflowItemsTable.workflowId, wfRow.id));

      const itemIds = items.map(i => i.id);

      if (itemIds.length > 0) {
        // Delete item history
        const histResult = await db
          .delete(workflowItemHistoryTable)
          .where(inArray(workflowItemHistoryTable.itemId, itemIds));
        deletedHistoryRows = (histResult as unknown as { rowCount?: number })?.rowCount ?? itemIds.length;

        // Delete workflow items
        const itemResult = await db
          .delete(workflowItemsTable)
          .where(inArray(workflowItemsTable.id, itemIds));
        deletedWorkflowItems = (itemResult as unknown as { rowCount?: number })?.rowCount ?? itemIds.length;
      }

      // Delete the workflow stages
      await db.delete(stagesTable).where(eq(stagesTable.workflowId, wfRow.id));

      // Delete the workflow itself
      await db.delete(workflowsTable).where(eq(workflowsTable.id, wfRow.id));
    }

    // Delete all work orders
    const woResult = await db.delete(workOrdersTable);
    const deletedWorkOrders = (woResult as unknown as { rowCount?: number })?.rowCount ?? 0;

    req.log.info({ deletedWorkOrders, deletedWorkflowItems, deletedHistoryRows }, "Work order data reset complete");

    res.json({
      success: true,
      deleted: {
        workOrders: deletedWorkOrders,
        workflowItems: deletedWorkflowItems,
        historyRows: deletedHistoryRows,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Work order reset failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/work-orders/import ─────────────────────────────────────────────

router.post("/work-orders/import", async (req, res) => {
  try {
    const {
      rows,
      slaDeadlineHours = DEFAULT_SLA_HOURS,
      createWorkflowItems = true,
    } = req.body as {
      rows?: Record<string, string>[];
      slaDeadlineHours?: number;
      createWorkflowItems?: boolean;
    };

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "rows[] array is required" });
      return;
    }

    const batchId = randomUUID();

    // Property resolution cache (avoid repeated DB lookups for same property)
    const propertyCache = new Map<string, { propertyId: number | null; confidence: string }>();

    // Get / provision system workflow
    const wfData = createWorkflowItems ? await getOrCreateWorkOrdersWorkflow() : null;

    const results: {
      row: number;
      status: "imported" | "error";
      workOrderId?: number;
      workflowItemId?: number;
      unitMatched: boolean;
      propertyMatched: boolean;
      propertyConfidence?: string;
      slaStatus: string;
      isBlocked: boolean;
      bottleneckType?: string | null;
    }[] = [];

    let importedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];

      try {
        // ── Core fields ──────────────────────────────────────────────────────
        const externalId       = extractField(raw, "work_order_id");
        const categoryRaw      = extractField(raw, "category");
        const description      = extractField(raw, "description");
        const priorityRaw      = extractField(raw, "priority");
        const statusRaw        = extractField(raw, "status");
        const assignedTo       = extractField(raw, "assigned_to");
        const notesRaw         = extractField(raw, "notes");

        // ── Hierarchy ────────────────────────────────────────────────────────
        const regionName       = extractField(raw, "region_name");
        const propertyNameRaw  = extractField(raw, "property_name");
        const unitNumberRaw    = extractField(raw, "unit_number");
        const turnId           = extractField(raw, "turn_id");

        // ── Timeline ────────────────────────────────────────────────────────
        const createdRaw       = extractField(raw, "created_date");
        const scheduledRaw     = extractField(raw, "scheduled_date");
        const responseRaw      = extractField(raw, "first_response_date");
        const completedRaw     = extractField(raw, "completed_date");

        // ── Labor hours ──────────────────────────────────────────────────────
        const estimatedHours   = parseFloat2(extractField(raw, "estimated_hours"));
        const actualHours      = parseFloat2(extractField(raw, "actual_hours"));

        // ── Turn stage ───────────────────────────────────────────────────────
        const stage            = extractField(raw, "stage");
        const stageStatus      = extractField(raw, "stage_status");
        const daysInStage      = parseInt2(extractField(raw, "days_in_stage"));

        // ── Blockage ────────────────────────────────────────────────────────
        const isBlocked        = parseBool(extractField(raw, "is_blocked"));
        const delayReason      = extractField(raw, "delay_reason");
        const vendor           = extractField(raw, "vendor");

        // ── Bottleneck ───────────────────────────────────────────────────────
        const bottleneckFlag   = parseBool(extractField(raw, "bottleneck_flag"));
        const bottleneckType   = extractField(raw, "bottleneck_type") ?? null;
        const aggregationScope = extractField(raw, "aggregation_scope");

        // ── Normalization ────────────────────────────────────────────────────
        const category         = normalizeCategory(categoryRaw);
        const priority         = normalizePriority(priorityRaw);
        const status           = normalizeStatus(statusRaw ?? (completedRaw ? "completed" : undefined));
        const createdDate      = parseDate(createdRaw);
        const scheduledDate    = parseDate(scheduledRaw);
        const firstResponseDate = parseDate(responseRaw);
        const completedDate    = parseDate(completedRaw);

        // ── Property matching (cached) ────────────────────────────────────────
        let propertyId: number | null = null;
        let propertyConfidence = "none";

        if (propertyNameRaw) {
          const cacheKey = propertyNameRaw.toLowerCase().trim();
          if (propertyCache.has(cacheKey)) {
            const cached = propertyCache.get(cacheKey)!;
            propertyId = cached.propertyId;
            propertyConfidence = cached.confidence;
          } else {
            const resolved = await resolveProperty(propertyNameRaw);
            propertyId = resolved.propertyId;
            propertyConfidence = resolved.confidence;
            propertyCache.set(cacheKey, { propertyId, confidence: propertyConfidence });
          }
        }

        // ── Unit matching within property ─────────────────────────────────────
        let unitId: number | null = null;
        if (unitNumberRaw && propertyId) {
          unitId = await resolveUnit(unitNumberRaw, propertyId);
        }

        // ── SLA computation ──────────────────────────────────────────────────
        const sla = computeSla(createdDate, firstResponseDate, slaDeadlineHours);

        // ── Insert work order ────────────────────────────────────────────────
        const [wo] = await db.insert(workOrdersTable).values({
          externalId: externalId ?? null,
          propertyId,
          unitId,
          assetId: null,
          workflowItemId: null,

          // Core
          category,
          description: description ?? null,
          priority,
          status,
          assignedTo: assignedTo ?? null,
          notes: notesRaw ?? null,

          // Hierarchy
          regionName: regionName ?? null,
          propertyNameRaw: propertyNameRaw ?? null,
          unitNumberRaw: unitNumberRaw ?? null,
          turnId: turnId ?? null,

          // Timeline
          createdDate,
          scheduledDate,
          firstResponseDate,
          completedDate,

          // Labor
          estimatedHours,
          actualHours,

          // SLA
          slaDeadlineHours,
          slaStatus: sla.status,
          slaResponseDelayHours: sla.delayHours,

          // Turn stage
          stage: stage ?? null,
          stageStatus: stageStatus ?? null,
          daysInStage,

          // Blockage
          isBlocked,
          delayReason: delayReason ?? null,
          vendor: vendor ?? null,

          // Bottleneck
          bottleneckFlag,
          bottleneckType: bottleneckType ?? null,
          aggregationScope: aggregationScope ?? null,

          // Raw + import metadata
          rawData: raw,
          importBatchId: batchId,
          importedAt: new Date(),
          updatedAt: new Date(),
        }).returning();

        // ── Create workflow item ──────────────────────────────────────────────
        let workflowItemId: number | undefined;
        if (createWorkflowItems && wfData) {
          const itemId = await createWorkflowItemForWorkOrder(wo, wfData);
          if (itemId) {
            await db.update(workOrdersTable)
              .set({ workflowItemId: itemId })
              .where(eq(workOrdersTable.id, wo.id));
            workflowItemId = itemId;
          }
        }

        importedCount++;
        results.push({
          row: i,
          status: "imported",
          workOrderId: wo.id,
          workflowItemId,
          unitMatched: unitId !== null,
          propertyMatched: propertyId !== null,
          propertyConfidence,
          slaStatus: sla.status,
          isBlocked,
          bottleneckType,
        });
      } catch (err) {
        req.log.warn({ err, row: i }, "Failed to import work order row");
        errorCount++;
        results.push({
          row: i,
          status: "error",
          unitMatched: false,
          propertyMatched: false,
          slaStatus: "pending",
          isBlocked: false,
        });
      }
    }

    const slaViolations = results.filter(r => r.slaStatus === "missed").length;
    const blockedCount = results.filter(r => r.isBlocked).length;
    const propertySummary = results.reduce((acc, r) => {
      acc[r.propertyConfidence ?? "none"] = (acc[r.propertyConfidence ?? "none"] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    req.log.info({ importedCount, errorCount, batchId, blockedCount }, "Work orders imported");

    res.json({
      batchId,
      imported: importedCount,
      errors: errorCount,
      slaViolations,
      blockedCount,
      propertySummary,
      results,
    });
  } catch (err) {
    req.log.error({ err }, "Work order import failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/work-orders/stats ───────────────────────────────────────────────

router.get("/work-orders/stats", async (req, res) => {
  try {
    const stats = await getWorkOrderStats();
    res.json(stats);
  } catch (err) {
    req.log.error({ err }, "Failed to get work order stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/work-orders/categories ─────────────────────────────────────────

router.get("/work-orders/categories", async (req, res) => {
  try {
    const stats = await getWorkOrderStats();
    res.json(stats.categories);
  } catch (err) {
    req.log.error({ err }, "Failed to get category breakdown");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/work-orders ─────────────────────────────────────────────────────

router.get("/work-orders", async (req, res) => {
  try {
    const {
      status, category, slaStatus, propertyId, unitId, isBlocked,
      bottleneckType, stage, regionName,
      limit = "200", offset = "0",
    } = req.query as Record<string, string>;

    const conditions = [];
    if (status) conditions.push(eq(workOrdersTable.status, status));
    if (category) conditions.push(eq(workOrdersTable.category, category));
    if (slaStatus) conditions.push(eq(workOrdersTable.slaStatus, slaStatus));
    if (propertyId) conditions.push(eq(workOrdersTable.propertyId, parseInt(propertyId)));
    if (unitId) conditions.push(eq(workOrdersTable.unitId, parseInt(unitId)));
    if (isBlocked === "true") conditions.push(eq(workOrdersTable.isBlocked, true));
    if (bottleneckType) conditions.push(eq(workOrdersTable.bottleneckType, bottleneckType));
    if (stage) conditions.push(eq(workOrdersTable.stage, stage));
    if (regionName) conditions.push(eq(workOrdersTable.regionName, regionName));

    const wos = await db
      .select()
      .from(workOrdersTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(workOrdersTable.importedAt))
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    const enriched = await enrichWorkOrders(wos);
    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "Failed to list work orders");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/work-orders/:id ─────────────────────────────────────────────────

router.get("/work-orders/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const wos = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
    if (wos.length === 0) { res.status(404).json({ error: "Not found" }); return; }

    const [enriched] = await enrichWorkOrders(wos);
    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "Failed to get work order");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
