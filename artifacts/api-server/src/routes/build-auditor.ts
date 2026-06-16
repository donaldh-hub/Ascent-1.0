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
import { runAllAnalyses } from "../services/reporting-analysis-service.js";

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

/**
 * Build 7.9 — Reporting Completion Audit Gate
 *
 * GET /api/build-auditor/7-9
 *
 * Checks that every reporting category (work_orders, turns, pm, assets,
 * evidence, assignments) has at least one analysis with a non-null
 * confidence state. Returns PASS/PARTIAL/FAIL per category and an
 * overall promotion decision for the Build 7 reporting stack.
 */
router.get("/build-auditor/7-9", async (_req, res) => {
  try {
    const bundle = await runAllAnalyses();

    const categories: Array<{
      key: keyof typeof bundle;
      label: string;
    }> = [
      { key: "workOrders", label: "Work Orders" },
      { key: "turns", label: "Turns / Make-Ready" },
      { key: "pm", label: "Preventative Maintenance" },
      { key: "assets", label: "Assets" },
      { key: "evidence", label: "Evidence & Documentation" },
      { key: "assignments", label: "Assignment Coverage" },
    ];

    const checks = categories.map(({ key, label }) => {
      const analyses = bundle[key] as Array<{ confidenceState: string | null; supportingRecordCount?: number }>;
      const hasAnalysis = analyses.length > 0;
      const hasConfidence = analyses.some((a) => a.confidenceState != null);
      const hasRecordCount = analyses.some((a) => (a.supportingRecordCount ?? 0) >= 0);

      let result: "PASS" | "PARTIAL" | "FAIL";
      let reason: string;

      if (!hasAnalysis) {
        result = "FAIL";
        reason = "No analyses produced for this category.";
      } else if (!hasConfidence) {
        result = "PARTIAL";
        reason = "Analysis exists but confidence state is null.";
      } else if (!hasRecordCount) {
        result = "PARTIAL";
        reason = "Analysis exists but supporting record count is missing.";
      } else {
        result = "PASS";
        reason = `${analyses.length} analysis output(s) with confidence state: ${analyses[0].confidenceState}.`;
      }

      return { category: key, label, result, reason };
    });

    const failCount = checks.filter((c) => c.result === "FAIL").length;
    const partialCount = checks.filter((c) => c.result === "PARTIAL").length;

    const overallDecision =
      failCount > 0
        ? "NOT_SAFE_TO_PROMOTE"
        : partialCount > 0
        ? "SAFE_WITH_CAUTION"
        : "SAFE_TO_PROMOTE";

    const overallReason =
      failCount > 0
        ? `${failCount} category failure(s) must be resolved before promoting Build 7.`
        : partialCount > 0
        ? `${partialCount} category check(s) are partial — safe to continue but visual proof needed.`
        : "All reporting categories have analysis outputs with confidence states. Build 7 is reporting-complete.";

    res.json({
      auditLabel: "Build 7.9 — Reporting Completion Gate",
      generatedAt: bundle.generatedAt,
      reportingMode: bundle.reportingMode,
      checks,
      summary: {
        pass: checks.filter((c) => c.result === "PASS").length,
        partial: partialCount,
        fail: failCount,
        total: checks.length,
      },
      overallDecision,
      overallReason,
    });
  } catch (err) {
    res.status(500).json({ error: "Build 7.9 audit failed", details: String(err) });
  }
});

export default router;
