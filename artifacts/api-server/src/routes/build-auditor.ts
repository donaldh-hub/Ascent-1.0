/**
 * Ascent Build Auditor — internal-only routes.
 *
 * Not customer-facing. These endpoints power /dev/build-auditor.
 *
 *   POST /api/build-auditor/run       — run a fresh audit, persist, return bundle.
 *   GET  /api/build-auditor/history   — list recent audits (last 20).
 *   GET  /api/build-auditor/:id       — fetch a stored audit by id.
 */

import { Router, type IRouter } from "express";
import {
  runAudit,
  saveAudit,
  listRecentAudits,
  getAuditById,
} from "../services/build-auditor-service.js";

const router: IRouter = Router();

router.post("/build-auditor/run", async (req, res) => {
  try {
    const buildLabel =
      typeof req.body?.buildLabel === "string" && req.body.buildLabel.trim().length > 0
        ? req.body.buildLabel.trim()
        : `Audit ${new Date().toISOString().slice(0, 19)}Z`;
    const bundle = await runAudit(buildLabel);
    const saved = await saveAudit(bundle);
    res.json({ id: saved.id, createdAt: saved.createdAt, ...bundle });
  } catch (err) {
    req.log.error({ err }, "build-auditor run failed");
    res.status(500).json({ error: "audit run failed", detail: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/build-auditor/history", async (req, res) => {
  try {
    const rows = await listRecentAudits(20);
    res.json({
      audits: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        buildLabel: r.buildLabel,
        status: r.status,
        summary: r.summary,
        passCount: r.passCount,
        partialCount: r.partialCount,
        failCount: r.failCount,
        manualCount: r.manualCount,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "build-auditor history failed");
    res.status(500).json({ error: "history fetch failed" });
  }
});

router.get("/build-auditor/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "invalid id" });
    }
    const row = await getAuditById(id);
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "build-auditor get failed");
    res.status(500).json({ error: "fetch failed" });
  }
});

export default router;
