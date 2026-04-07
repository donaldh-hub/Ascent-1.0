/**
 * Build 2.5 — Work Order Routes
 *
 * POST /api/work-orders/import     — CSV row ingestion + unit matching + SLA + workflow items
 * GET  /api/work-orders            — list with filters
 * GET  /api/work-orders/stats      — aggregate stats for dashboard
 * GET  /api/work-orders/categories — category breakdown
 * GET  /api/work-orders/:id        — detail view
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  workOrdersTable,
  unitsTable,
  propertiesTable,
} from "@workspace/db/schema";
import { eq, and, or, inArray, desc, isNull, lt } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  extractField,
  parseDate,
  normalizePriority,
  normalizeStatus,
  normalizeCategory,
  computeSla,
  DEFAULT_SLA_HOURS,
  getOrCreateWorkOrdersWorkflow,
  createWorkflowItemForWorkOrder,
  getWorkOrderStats,
} from "../services/work-order-service";
import { AssignmentEngine, extractHintsFromRow } from "../engine/assignment";

const router = Router();

// ─── Enrich a work order with unit/property names ─────────────────────────────

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
    unitNumber: wo.unitId ? (unitMap.get(wo.unitId)?.unitNumber ?? null) : null,
    propertyName: wo.propertyId ? (propMap.get(wo.propertyId) ?? null) : null,
    createdDate: wo.createdDate?.toISOString() ?? null,
    firstResponseDate: wo.firstResponseDate?.toISOString() ?? null,
    completedDate: wo.completedDate?.toISOString() ?? null,
    importedAt: wo.importedAt.toISOString(),
    updatedAt: wo.updatedAt.toISOString(),
  }));
}

// ─── POST /api/work-orders/import ─────────────────────────────────────────────

router.post("/work-orders/import", async (req, res) => {
  try {
    const { rows, slaDeadlineHours = DEFAULT_SLA_HOURS, createWorkflowItems = true } = req.body as {
      rows?: Record<string, string>[];
      slaDeadlineHours?: number;
      createWorkflowItems?: boolean;
    };

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "rows[] array is required" });
      return;
    }

    const batchId = randomUUID();

    // Load unit matching engine
    const engine = new AssignmentEngine();

    // Get / provision system workflow
    const wfData = createWorkflowItems ? await getOrCreateWorkOrdersWorkflow() : null;

    const results: {
      row: number;
      status: "imported" | "unmatched" | "error";
      workOrderId?: number;
      workflowItemId?: number;
      unitMatched: boolean;
      propertyMatched: boolean;
      slaStatus: string;
    }[] = [];

    let importedCount = 0;
    let unmatchedCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];

      try {
        const externalId   = extractField(raw, "work_order_id");
        const categoryRaw  = extractField(raw, "category");
        const description  = extractField(raw, "description");
        const priorityRaw  = extractField(raw, "priority");
        const statusRaw    = extractField(raw, "status");
        const createdRaw   = extractField(raw, "created_date");
        const responseRaw  = extractField(raw, "first_response_date");
        const completedRaw = extractField(raw, "completed_date");

        const category         = normalizeCategory(categoryRaw);
        const priority         = normalizePriority(priorityRaw);
        const status           = normalizeStatus(statusRaw ?? (completedRaw ? "completed" : undefined));
        const createdDate      = parseDate(createdRaw);
        const firstResponseDate = parseDate(responseRaw);
        const completedDate    = parseDate(completedRaw);

        // Unit matching via assignment engine
        const hints = extractHintsFromRow(raw);
        let unitId: number | null = null;
        let propertyId: number | null = null;

        if (hints.unitHint || hints.propertyHint) {
          const matchResults = await engine.processBatch([{
            sourceType: "work_order",
            rawData: raw,
            unitHint: hints.unitHint,
            propertyHint: hints.propertyHint,
            descriptionHint: hints.descriptionHint,
          }]);
          const match = matchResults[0];
          if (match?.status === "assigned" && match.match.targetEntityType === "unit") {
            unitId = match.match.targetEntityId ?? null;
            // Resolve property from unit
            if (unitId) {
              const unit = await db.select().from(unitsTable).where(eq(unitsTable.id, unitId));
              propertyId = unit[0]?.propertyId ?? null;
            }
          }
        }

        // SLA computation
        const sla = computeSla(createdDate, firstResponseDate, slaDeadlineHours);

        // Insert work order
        const [wo] = await db.insert(workOrdersTable).values({
          externalId: externalId ?? null,
          propertyId,
          unitId,
          assetId: null,
          workflowItemId: null,
          category,
          description: description ?? null,
          priority,
          status,
          createdDate,
          firstResponseDate,
          completedDate,
          slaDeadlineHours,
          slaStatus: sla.status,
          slaResponseDelayHours: sla.delayHours,
          rawData: raw,
          importBatchId: batchId,
          importedAt: new Date(),
          updatedAt: new Date(),
        }).returning();

        // Create workflow item
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
          slaStatus: sla.status,
        });
      } catch (err) {
        req.log.warn({ err, row: i }, "Failed to import work order row");
        unmatchedCount++;
        results.push({
          row: i,
          status: "error",
          unitMatched: false,
          propertyMatched: false,
          slaStatus: "pending",
        });
      }
    }

    const slaViolations = results.filter(r => r.slaStatus === "missed").length;

    req.log.info({ importedCount, unmatchedCount, batchId }, "Work orders imported");

    res.json({
      batchId,
      imported: importedCount,
      errors: unmatchedCount,
      slaViolations,
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
    const { status, category, slaStatus, propertyId, unitId, limit = "100", offset = "0" } = req.query as Record<string, string>;

    const conditions = [];
    if (status) conditions.push(eq(workOrdersTable.status, status));
    if (category) conditions.push(eq(workOrdersTable.category, category));
    if (slaStatus) conditions.push(eq(workOrdersTable.slaStatus, slaStatus));
    if (propertyId) conditions.push(eq(workOrdersTable.propertyId, parseInt(propertyId)));
    if (unitId) conditions.push(eq(workOrdersTable.unitId, parseInt(unitId)));

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
