import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { alertsTable, documentsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { ListAlertsQueryParams, CreateDocumentBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/alerts", async (req, res) => {
  try {
    const query = ListAlertsQueryParams.parse(req.query);
    let rows = await db.select().from(alertsTable);
    if (query.unreadOnly) rows = rows.filter((a) => !a.isRead);
    if (query.severity) rows = rows.filter((a) => a.severity === query.severity);
    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    res.json(rows.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })));
  } catch (err) {
    req.log.error({ err }, "Failed to list alerts");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/alerts/:id/read", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [alert] = await db
      .update(alertsTable)
      .set({ isRead: true })
      .where(eq(alertsTable.id, id))
      .returning();
    if (!alert) return res.status(404).json({ error: "Not found" });
    res.json({ ...alert, createdAt: alert.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Failed to mark alert read");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/documents", async (req, res) => {
  try {
    const workflowId = req.query.workflowId ? parseInt(req.query.workflowId as string) : undefined;
    const assetId = req.query.assetId ? parseInt(req.query.assetId as string) : undefined;

    let rows = await db.select().from(documentsTable);
    if (workflowId) rows = rows.filter((d) => d.workflowId === workflowId);
    if (assetId) rows = rows.filter((d) => d.assetId === assetId);

    res.json(rows.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })));
  } catch (err) {
    req.log.error({ err }, "Failed to list documents");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/documents", async (req, res) => {
  try {
    const body = CreateDocumentBody.parse(req.body);
    const [doc] = await db.insert(documentsTable).values(body).returning();
    res.status(201).json({ ...doc, createdAt: doc.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Failed to create document");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
