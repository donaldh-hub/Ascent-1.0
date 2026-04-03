/**
 * Phase 1 — Build 1.7: Assignment Engine Routes
 */

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { assignmentsTable, unitsTable, propertiesTable } from "@workspace/db/schema";
import { eq, and, inArray, or } from "drizzle-orm";
import { AssignmentEngine, extractHintsFromRow, type SourceRecord } from "../engine/assignment";
import { onAssignmentEvent } from "../engine/system-integration";
import type { AssignmentSourceType } from "@workspace/db/schema";

const router: IRouter = Router();

// ─── Enrich assignment ────────────────────────────────────────────────────────

function enrichAssignment(a: typeof assignmentsTable.$inferSelect) {
  return {
    ...a,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

// ─── POST /api/assignments/process ────────────────────────────────────────────
// Accept an array of CSV rows + sourceType, run the engine, return results.

router.post("/assignments/process", async (req, res) => {
  try {
    const { sourceType, rows } = req.body as {
      sourceType?: AssignmentSourceType;
      rows?: Record<string, string>[];
    };

    if (!sourceType || !Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "sourceType and rows[] are required" });
      return;
    }

    const records: SourceRecord[] = rows.map((row) => {
      const hints = extractHintsFromRow(row);
      return {
        sourceType,
        rawData: row,
        unitHint: hints.unitHint,
        propertyHint: hints.propertyHint,
        descriptionHint: hints.descriptionHint,
      };
    });

    const engine = new AssignmentEngine();
    const results = await engine.processBatch(records);

    const summary = {
      total: results.length,
      autoAssigned: results.filter((r) => r.status === "assigned").length,
      pendingConfirmation: results.filter(
        (r) => r.status === "pending" && r.match.confidenceLevel === "medium"
      ).length,
      reviewRequired: results.filter(
        (r) => r.status === "pending" && r.match.confidenceLevel === "low"
      ).length,
    };

    req.log.info({ summary }, "Assignment batch processed");

    res.json({ results, summary });
  } catch (err) {
    req.log.error({ err }, "Failed to process assignments");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/assignments ─────────────────────────────────────────────────────
// List all assignments with optional status filter.

router.get("/assignments", async (req, res) => {
  try {
    const { status, unitId, confidenceLevel } = req.query as {
      status?: string;
      unitId?: string;
      confidenceLevel?: string;
    };

    let query = db.select().from(assignmentsTable);
    const conditions = [];

    if (status) conditions.push(eq(assignmentsTable.status, status));
    if (unitId) conditions.push(and(
      eq(assignmentsTable.targetEntityType, "unit"),
      eq(assignmentsTable.targetEntityId, Number(unitId))
    )!);
    if (confidenceLevel) conditions.push(eq(assignmentsTable.confidenceLevel, confidenceLevel));

    const rows = conditions.length > 0
      ? await db.select().from(assignmentsTable).where(and(...conditions)).orderBy(assignmentsTable.createdAt)
      : await db.select().from(assignmentsTable).orderBy(assignmentsTable.createdAt);

    // Enrich with unit + property info
    const unitIds = [...new Set(rows.filter((r) => r.targetEntityId).map((r) => r.targetEntityId!))];
    const units = unitIds.length > 0
      ? await db.select().from(unitsTable).where(inArray(unitsTable.id, unitIds))
      : [];
    const propIds = [...new Set(units.map((u) => u.propertyId))];
    const properties = propIds.length > 0
      ? await db.select().from(propertiesTable).where(inArray(propertiesTable.id, propIds))
      : [];

    const unitMap = new Map(units.map((u) => [u.id, u]));
    const propMap = new Map(properties.map((p) => [p.id, p]));

    const enriched = rows.map((a) => ({
      ...enrichAssignment(a),
      unit: a.targetEntityId ? (unitMap.get(a.targetEntityId) ?? null) : null,
      property: a.targetEntityId
        ? (() => {
            const u = unitMap.get(a.targetEntityId);
            return u ? (propMap.get(u.propertyId) ?? null) : null;
          })()
        : null,
    }));

    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "Failed to list assignments");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/assignments/review ─────────────────────────────────────────────
// List all pending (unmatched / low confidence / rejected) assignments for review.

router.get("/assignments/review", async (req, res) => {
  try {
    const rows = await db.select().from(assignmentsTable)
      .where(or(
        eq(assignmentsTable.status, "pending"),
        eq(assignmentsTable.status, "rejected")
      ))
      .orderBy(assignmentsTable.createdAt);

    // Enrich with unit + property info where available
    const unitIds = [...new Set(rows.filter((r) => r.targetEntityId).map((r) => r.targetEntityId!))];
    const units = unitIds.length > 0
      ? await db.select().from(unitsTable).where(inArray(unitsTable.id, unitIds))
      : [];
    const propIds = [...new Set(units.map((u) => u.propertyId))];
    const properties = propIds.length > 0
      ? await db.select().from(propertiesTable).where(inArray(propertiesTable.id, propIds))
      : [];

    const unitMap = new Map(units.map((u) => [u.id, u]));
    const propMap = new Map(properties.map((p) => [p.id, p]));

    const enriched = rows.map((a) => ({
      ...enrichAssignment(a),
      unit: a.targetEntityId ? (unitMap.get(a.targetEntityId) ?? null) : null,
      property: a.targetEntityId
        ? (() => {
            const u = unitMap.get(a.targetEntityId);
            return u ? (propMap.get(u.propertyId) ?? null) : null;
          })()
        : null,
    }));

    res.json(enriched);
  } catch (err) {
    req.log.error({ err }, "Failed to list review queue");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/assignments/unit/:unitId ────────────────────────────────────────
// All assigned records for a specific unit (used by unit profile + history).

router.get("/assignments/unit/:unitId", async (req, res) => {
  try {
    const unitId = parseInt(req.params.unitId, 10);
    if (isNaN(unitId)) { res.status(400).json({ error: "Invalid unit id" }); return; }

    const rows = await db.select().from(assignmentsTable)
      .where(and(
        eq(assignmentsTable.targetEntityType, "unit"),
        eq(assignmentsTable.targetEntityId, unitId),
        eq(assignmentsTable.status, "assigned")
      ))
      .orderBy(assignmentsTable.createdAt);

    res.json(rows.map(enrichAssignment));
  } catch (err) {
    req.log.error({ err }, "Failed to get unit assignments");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/assignments/:id/confirm ───────────────────────────────────────

router.post("/assignments/:id/confirm", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    await AssignmentEngine.confirmAssignment(id);
    await onAssignmentEvent("assignment_confirmed", id);
    req.log.info({ assignmentId: id }, "Assignment confirmed");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to confirm assignment");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/assignments/:id/reject ────────────────────────────────────────

router.post("/assignments/:id/reject", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    await AssignmentEngine.rejectAssignment(id);
    await onAssignmentEvent("assignment_rejected", id);
    req.log.info({ assignmentId: id }, "Assignment rejected");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to reject assignment");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/assignments/:id/manual ────────────────────────────────────────

router.post("/assignments/:id/manual", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { unitId } = req.body as { unitId?: number };
    if (isNaN(id) || !unitId) {
      res.status(400).json({ error: "Valid id and unitId are required" });
      return;
    }
    await AssignmentEngine.manualAssign(id, unitId);
    await onAssignmentEvent("assignment_manual", id);
    req.log.info({ assignmentId: id, unitId }, "Assignment manually assigned");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to manually assign");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
