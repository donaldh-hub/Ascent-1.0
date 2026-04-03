import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { propertiesTable, unitsTable } from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";

const router: IRouter = Router();

function enrichProperty(p: typeof propertiesTable.$inferSelect) {
  return { ...p, createdAt: p.createdAt.toISOString() };
}

function enrichUnit(u: typeof unitsTable.$inferSelect) {
  return { ...u, createdAt: u.createdAt.toISOString() };
}

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
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid property id" });
      return;
    }
    await db.delete(unitsTable).where(eq(unitsTable.propertyId, id));
    await db.delete(propertiesTable).where(eq(propertiesTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete property");
    res.status(500).json({ error: "Internal server error" });
  }
});

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

router.delete("/units/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid unit id" });
      return;
    }
    await db.delete(unitsTable).where(eq(unitsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete unit");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
