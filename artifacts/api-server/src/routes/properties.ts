import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { propertiesTable, unitsTable, documentsTable, assignmentsTable } from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";

const router: IRouter = Router();

function enrichProperty(p: typeof propertiesTable.$inferSelect) {
  return { ...p, createdAt: p.createdAt.toISOString() };
}

function enrichUnit(u: typeof unitsTable.$inferSelect) {
  return { ...u, createdAt: u.createdAt.toISOString() };
}

// ─── Properties ──────────────────────────────────────────────────────────────

router.get("/properties", async (req, res) => {
  try {
    const rows = await db.select().from(propertiesTable).orderBy(propertiesTable.createdAt);
    res.json(rows.map(enrichProperty));
  } catch (err) {
    req.log.error({ err }, "Failed to list properties");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/properties", async (req, res) => {
  try {
    const { name, address } = req.body as { name: string; address?: string };
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "Property name is required" });
      return;
    }
    const [prop] = await db.insert(propertiesTable).values({ name: name.trim(), address: address?.trim() ?? null }).returning();
    res.status(201).json(enrichProperty(prop));
  } catch (err) {
    req.log.error({ err }, "Failed to create property");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/properties/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid property id" }); return; }
    await db.delete(unitsTable).where(eq(unitsTable.propertyId, id));
    await db.delete(propertiesTable).where(eq(propertiesTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete property");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Units ───────────────────────────────────────────────────────────────────

router.get("/units", async (req, res) => {
  try {
    const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string, 10) : undefined;
    const rows = propertyId && !isNaN(propertyId)
      ? await db.select().from(unitsTable).where(eq(unitsTable.propertyId, propertyId)).orderBy(unitsTable.unitNumber)
      : await db.select().from(unitsTable).orderBy(unitsTable.propertyId, unitsTable.unitNumber);
    res.json(rows.map(enrichUnit));
  } catch (err) {
    req.log.error({ err }, "Failed to list units");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/units", async (req, res) => {
  try {
    const { propertyId, unitNumber, metadata } = req.body as { propertyId: number; unitNumber: string; metadata?: Record<string, unknown> };
    if (!propertyId || !unitNumber?.trim()) {
      res.status(400).json({ error: "propertyId and unitNumber are required" });
      return;
    }
    const existing = await db.select({ id: unitsTable.id }).from(unitsTable)
      .where(and(eq(unitsTable.propertyId, propertyId), eq(unitsTable.unitNumber, unitNumber.trim())));
    if (existing.length > 0) {
      res.status(409).json({ error: "Unit already exists in this property", unitId: existing[0].id });
      return;
    }
    const [unit] = await db.insert(unitsTable).values({ propertyId, unitNumber: unitNumber.trim(), metadata: metadata ?? {} }).returning();
    res.status(201).json(enrichUnit(unit));
  } catch (err) {
    req.log.error({ err }, "Failed to create unit");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/units/import", async (req, res) => {
  try {
    const { propertyId, units } = req.body as { propertyId: number; units: Array<{ unitNumber: string; metadata?: Record<string, unknown> }> };
    if (!propertyId || !Array.isArray(units) || units.length === 0) {
      res.status(400).json({ error: "propertyId and units array are required" });
      return;
    }
    const unitNumbers = units.map((u) => u.unitNumber?.trim()).filter(Boolean);
    const existingRows = await db.select({ unitNumber: unitsTable.unitNumber }).from(unitsTable)
      .where(and(eq(unitsTable.propertyId, propertyId), inArray(unitsTable.unitNumber, unitNumbers)));
    const existingSet = new Set(existingRows.map((r) => r.unitNumber));
    const toInsert = units
      .filter((u) => u.unitNumber?.trim() && !existingSet.has(u.unitNumber.trim()))
      .map((u) => ({ propertyId, unitNumber: u.unitNumber.trim(), metadata: u.metadata ?? {} }));
    let inserted: (typeof unitsTable.$inferSelect)[] = [];
    if (toInsert.length > 0) {
      inserted = await db.insert(unitsTable).values(toInsert).returning();
    }
    res.status(201).json({
      imported: inserted.length,
      skipped: units.length - toInsert.length,
      units: inserted.map(enrichUnit),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to import units");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Single unit (must come after /units/import POST) ────────────────────────

router.get("/units/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid unit id" }); return; }
    const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, id));
    if (!unit) { res.status(404).json({ error: "Unit not found" }); return; }
    const [property] = unit.propertyId
      ? await db.select().from(propertiesTable).where(eq(propertiesTable.id, unit.propertyId))
      : [];
    res.json({
      unit: enrichUnit(unit),
      property: property ? enrichProperty(property) : null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get unit");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Unit history timeline ────────────────────────────────────────────────────

router.get("/units/:id/history", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid unit id" }); return; }

    const [unit] = await db.select().from(unitsTable).where(eq(unitsTable.id, id));
    if (!unit) { res.status(404).json({ error: "Unit not found" }); return; }

    const [docs, assignments] = await Promise.all([
      db.select().from(documentsTable)
        .where(and(eq(documentsTable.linkedEntityType, "unit"), eq(documentsTable.linkedEntityId, id))),
      db.select().from(assignmentsTable)
        .where(and(
          eq(assignmentsTable.targetEntityType, "unit"),
          eq(assignmentsTable.targetEntityId, id),
          eq(assignmentsTable.status, "assigned")
        )),
    ]);

    type HistoryEvent = {
      id: string;
      eventType: "unit_created" | "document_uploaded" | "record_assigned";
      title: string;
      description: string;
      timestamp: string;
      actor: string;
      meta: Record<string, unknown>;
    };

    const events: HistoryEvent[] = [];

    events.push({
      id: `unit_created_${unit.id}`,
      eventType: "unit_created",
      title: "Unit added to system",
      description: `Unit ${unit.unitNumber} was added to the property roster.`,
      timestamp: unit.createdAt.toISOString(),
      actor: "System",
      meta: { unitId: unit.id, unitNumber: unit.unitNumber },
    });

    for (const doc of docs) {
      events.push({
        id: `doc_${doc.id}`,
        eventType: "document_uploaded",
        title: `Document uploaded`,
        description: `${doc.fileName} (${doc.documentType}) was uploaded.`,
        timestamp: doc.uploadedAt.toISOString(),
        actor: doc.uploadedBy ?? "System",
        meta: {
          documentId: doc.id,
          fileName: doc.fileName,
          documentType: doc.documentType,
          objectPath: doc.objectPath,
        },
      });
    }

    for (const asgn of assignments) {
      const sourceLabel = asgn.sourceType.replace(/_/g, " ");
      const method = asgn.assignmentMethod ?? "auto";
      events.push({
        id: `assignment_${asgn.id}`,
        eventType: "record_assigned",
        title: `${sourceLabel.charAt(0).toUpperCase() + sourceLabel.slice(1)} assigned`,
        description: asgn.explanation,
        timestamp: asgn.createdAt.toISOString(),
        actor: method === "manual" ? "User" : method === "suggested" ? "User (confirmed)" : "Assignment Engine",
        meta: {
          assignmentId: asgn.id,
          sourceType: asgn.sourceType,
          confidenceLevel: asgn.confidenceLevel,
          assignmentMethod: method,
          sourceData: asgn.sourceData,
        },
      });
    }

    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json({
      unitId: id,
      events,
      documentCount: docs.length,
      workItemCount: 0,
      assetCount: 0,
      latestActivityAt: events[0]?.timestamp ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get unit history");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Delete unit ──────────────────────────────────────────────────────────────

router.delete("/units/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid unit id" }); return; }
    await db.delete(unitsTable).where(eq(unitsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete unit");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
