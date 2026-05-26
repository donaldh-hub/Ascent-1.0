/**
 * Ascent 7.2 — Reporting Analysis Routes
 *
 * Read-only surfaces over the reporting analysis orchestrator. Every
 * response carries the same AnalysisOutput contract, so the Reports page
 * and Control Tower tiles consume one shape regardless of category.
 *
 *   GET /api/reporting-analysis/all
 *     Returns every per-category analysis plus cross-category pressure.
 *
 *   GET /api/reporting-analysis/work-orders
 *   GET /api/reporting-analysis/turns
 *   GET /api/reporting-analysis/pm
 *   GET /api/reporting-analysis/assets
 *   GET /api/reporting-analysis/evidence
 *   GET /api/reporting-analysis/assignments
 *   GET /api/reporting-analysis/cross-category
 *     Per-category analyses. Each returns { analyses: AnalysisOutput[] }.
 *
 *   GET /api/reporting-analysis/supporting-records?analysisId=
 *     Hydrates the supportingRecordIds for a single analysis back into the
 *     full NormalizedReportingRecord objects so drill-down panels can
 *     render the proof set. Returns 404 when analysisId is unknown.
 */

import { Router, type IRouter } from "express";
import {
  runAllAnalyses,
  runAllAnalysesWithRecords,
  flattenBundle,
} from "../services/reporting-analysis-service.js";
import { loadSupportingRecordsFromPool } from "../services/supporting-record-mapper.js";

const router: IRouter = Router();

router.get("/reporting-analysis/all", async (_req, res) => {
  try {
    const bundle = await runAllAnalyses();
    res.json(bundle);
  } catch (err) {
    res.status(500).json({ error: "Failed to run reporting analysis", details: String(err) });
  }
});

const CATEGORY_KEY: Record<string, keyof Awaited<ReturnType<typeof runAllAnalyses>>> = {
  "work-orders": "workOrders",
  turns: "turns",
  pm: "pm",
  assets: "assets",
  evidence: "evidence",
  assignments: "assignments",
  "cross-category": "crossCategory",
};

for (const [path, key] of Object.entries(CATEGORY_KEY)) {
  router.get(`/reporting-analysis/${path}`, async (_req, res) => {
    try {
      const bundle = await runAllAnalyses();
      const analyses = bundle[key] as Awaited<ReturnType<typeof runAllAnalyses>>["workOrders"];
      res.json({
        generatedAt: bundle.generatedAt,
        category: path,
        analyses,
        count: analyses.length,
      });
    } catch (err) {
      res.status(500).json({ error: `Failed to run ${path} analysis`, details: String(err) });
    }
  });
}

router.get("/reporting-analysis/supporting-records", async (req, res) => {
  const analysisId = String(req.query.analysisId ?? "");
  if (!analysisId) {
    res.status(400).json({ error: "analysisId is required" });
    return;
  }
  try {
    // Run the orchestrator once and reuse its in-memory record pool for
    // hydration. Architect review flagged the previous implementation as
    // running every source normaliser twice per drill-down click.
    const bundle = await runAllAnalysesWithRecords();
    const analysis = flattenBundle(bundle).find((a) => a.analysisId === analysisId) ?? null;
    if (!analysis) {
      res.status(404).json({ error: "Unknown analysisId", analysisId });
      return;
    }
    const records = loadSupportingRecordsFromPool(
      analysis.supportingRecordIds,
      bundle.recordPool,
    );
    // Ascent 7.4 — merge per-record inclusion metadata onto the hydrated
    // record rows so the drill sheet can render "why am I here" for each
    // supporting record, matching the active reporting mode.
    const metaMap = analysis.recordInclusionMetadata ?? {};
    const recordsWithReason = records.map((r) => {
      const meta = metaMap[r.id];
      return {
        ...r,
        inclusionReason: meta?.inclusionReason ?? null,
        turnRelationConfidence: meta?.turnRelationConfidence ?? null,
      };
    });
    res.json({
      analysisId,
      analysisTitle: analysis.title,
      confidenceState: analysis.confidenceState,
      reportingModeUsed: analysis.reportingModeUsed,
      supportingRecordCount: analysis.supportingRecordCount,
      returnedCount: recordsWithReason.length,
      records: recordsWithReason,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load supporting records", details: String(err) });
  }
});

export default router;
