import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { alertsTable, documentsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { CreateDocumentBody } from "@workspace/api-zod";
import { evaluateAlerts, getAlertSummary } from "../engine/alerts";

const router: IRouter = Router();

function serializeAlert(a: typeof alertsTable.$inferSelect) {
  return {
    ...a,
    triggeredAt: (a.triggeredAt ?? a.createdAt).toISOString(),
    lastSeenAt: (a.lastSeenAt ?? a.createdAt).toISOString(),
    acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: a.resolvedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

// ─── GET /alerts ─────────────────────────────

router.get("/alerts", async (req, res) => {
  try {
    let rows = await db.select().from(alertsTable);

    const { unreadOnly, severity, level, category, status, isActive, workflowId } = req.query as Record<string, string>;

    if (unreadOnly === "true") rows = rows.filter((a) => !a.isRead);
    if (severity) rows = rows.filter((a) => a.severity === severity);
    if (level) rows = rows.filter((a) => a.level === level);
    if (category) rows = rows.filter((a) => a.category === category);
    if (status) rows = rows.filter((a) => a.status === status);
    if (isActive === "true") rows = rows.filter((a) => a.isActive);
    if (isActive === "false") rows = rows.filter((a) => !a.isActive);
    if (workflowId) rows = rows.filter((a) => a.workflowId === parseInt(workflowId));

    const levelOrder: Record<string, number> = { critical: 3, warning: 2, informational: 1 };
    rows.sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      const la = levelOrder[a.level ?? "informational"] ?? 1;
      const lb = levelOrder[b.level ?? "informational"] ?? 1;
      if (lb !== la) return lb - la;
      const ta = (a.triggeredAt ?? a.createdAt).getTime();
      const tb = (b.triggeredAt ?? b.createdAt).getTime();
      return tb - ta;
    });

    res.json(rows.map(serializeAlert));
  } catch (err) {
    req.log.error({ err }, "Failed to list alerts");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /alerts/summary ─────────────────────

router.get("/alerts/summary", async (req, res) => {
  try {
    const summary = await getAlertSummary();
    res.json(summary);
  } catch (err) {
    req.log.error({ err }, "Failed to get alert summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /alerts/evaluate ───────────────────

router.post("/alerts/evaluate", async (req, res) => {
  try {
    const result = await evaluateAlerts();
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to evaluate alerts");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /alerts/:id/read ──────────────────

router.patch("/alerts/:id/read", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [alert] = await db
      .update(alertsTable)
      .set({ isRead: true })
      .where(eq(alertsTable.id, id))
      .returning();
    if (!alert) return res.status(404).json({ error: "Not found" });
    res.json(serializeAlert(alert));
  } catch (err) {
    req.log.error({ err }, "Failed to mark alert read");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /alerts/:id/acknowledge ──────────

router.patch("/alerts/:id/acknowledge", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [alert] = await db
      .update(alertsTable)
      .set({
        status: "acknowledged",
        acknowledgedAt: new Date(),
        isRead: true,
      })
      .where(eq(alertsTable.id, id))
      .returning();
    if (!alert) return res.status(404).json({ error: "Not found" });
    res.json(serializeAlert(alert));
  } catch (err) {
    req.log.error({ err }, "Failed to acknowledge alert");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /alerts/:id/resolve ───────────────

router.patch("/alerts/:id/resolve", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [alert] = await db
      .update(alertsTable)
      .set({
        status: "resolved",
        isActive: false,
        resolvedAt: new Date(),
        isRead: true,
      })
      .where(eq(alertsTable.id, id))
      .returning();
    if (!alert) return res.status(404).json({ error: "Not found" });
    res.json(serializeAlert(alert));
  } catch (err) {
    req.log.error({ err }, "Failed to resolve alert");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Documents ───────────────────────────────

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
