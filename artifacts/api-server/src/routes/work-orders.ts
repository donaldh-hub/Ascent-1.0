/**
 * Build 2.5 — Work Order Routes (Extended: Turn + Bottleneck Layer)
 * Build 8.0 — Import Governance Layer (Phase 1: Dual-Mode Controlled Ingestion)
 *
 * POST /api/work-orders/reset              — clear all work-order + associated workflow data
 * POST /api/work-orders/import             — CSV row ingestion with governance classification
 * GET  /api/work-orders/imports/:batchId   — import run governance summary
 * GET  /api/work-orders                    — list with filters
 * GET  /api/work-orders/stats              — aggregate stats
 * GET  /api/work-orders/categories         — category breakdown
 * GET  /api/work-orders/:id                — detail view
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
import {
  WORK_ORDER_SIGNAL_WHERE,
  isWorkOrderSignal,
} from "../services/operational-selectors";
import {
  DEFAULT_SLA_HOURS,
  getWorkOrderStats,
  WO_WORKFLOW_TITLE,
} from "../services/work-order-service";
import { buildImpactAnalysis } from "../services/work-order-impact-service";
import { runDataIngestionInline, IngestionNotCompletedError } from "../services/agent-runtime/agents/data-ingestion-agent.js";
import {
  getImportSummary,
  type ImportMode,
} from "../services/governance-service";

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
      importMode = "flexible",
      sourceFileName,
    } = req.body as {
      rows?: Record<string, string>[];
      slaDeadlineHours?: number;
      createWorkflowItems?: boolean;
      importMode?: ImportMode;
      sourceFileName?: string;
    };

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "rows[] array is required" });
      return;
    }

    const result = await runDataIngestionInline({
      payload: { rows, slaDeadlineHours, createWorkflowItems, importMode, sourceFileName },
      organizationId: req.user?.hubId,
      authorizedUserId: req.user?.id,
    });

    res.json(result);
  } catch (err) {
    if (err instanceof IngestionNotCompletedError) {
      // The agent hit a transient failure on its first attempt and is now
      // retrying in the background rather than blocking this request —
      // still a real, tracked job, just not done synchronously.
      res.status(202).json({ status: "processing", detail: err.message });
      return;
    }
    req.log.error({ err }, "Work order import failed");
    res.status(500).json({ error: "Internal server error" });
  }
});


// ─── GET /api/work-orders/imports/:batchId ────────────────────────────────────

router.get("/work-orders/imports/:batchId", async (req, res) => {
  try {
    const { batchId } = req.params;
    const summary = await getImportSummary(batchId);
    if (!summary) {
      res.status(404).json({ error: "Import run not found" });
      return;
    }
    res.json(summary);
  } catch (err) {
    req.log.error({ err }, "Failed to get import summary");
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
      signal,
      limit = "200", offset = "0",
    } = req.query as Record<string, string>;

    const conditions = [];
    if (req.accessibleSiteIds) conditions.push(inArray(workOrdersTable.propertyId, req.accessibleSiteIds));
    if (status) conditions.push(eq(workOrdersTable.status, status));
    if (category) conditions.push(eq(workOrdersTable.category, category));
    if (slaStatus) conditions.push(eq(workOrdersTable.slaStatus, slaStatus));
    if (propertyId) conditions.push(eq(workOrdersTable.propertyId, parseInt(propertyId)));
    if (unitId) conditions.push(eq(workOrdersTable.unitId, parseInt(unitId)));
    if (isBlocked === "true") conditions.push(eq(workOrdersTable.isBlocked, true));
    if (bottleneckType) conditions.push(eq(workOrdersTable.bottleneckType, bottleneckType));
    if (stage) conditions.push(eq(workOrdersTable.stage, stage));
    if (regionName) conditions.push(eq(workOrdersTable.regionName, regionName));

    // Operational-signal filter (single source of truth — see operational-selectors.ts).
    if (signal && isWorkOrderSignal(signal)) {
      const signalWhere = WORK_ORDER_SIGNAL_WHERE[signal](
        propertyId ? parseInt(propertyId) : undefined,
      );
      if (signalWhere) conditions.push(signalWhere);
    }

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

// ─── GET /api/work-orders/impact ─────────────────────────────────────────────

router.get("/work-orders/impact", async (req, res) => {
  try {
    const analysis = await buildImpactAnalysis();
    res.json(analysis);
  } catch (err) {
    req.log.error({ err }, "Failed to build work order impact analysis");
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
    if (req.accessibleSiteIds && (!wos[0].propertyId || !req.accessibleSiteIds.includes(wos[0].propertyId))) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const [enriched] = await enrichWorkOrders(wos);
    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "Failed to get work order");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
