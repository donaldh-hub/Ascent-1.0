/**
 * Ascent 7.3 — Narrative Insights route
 *
 *   GET /api/narrative-insights
 *
 * Returns a structured NarrativeInsightsBundle computed from the active
 * reporting analysis bundle. Drill-through reuses the existing
 * /api/reporting-analysis/supporting-records endpoint (each insight
 * carries `sourceAnalysisId`).
 *
 * Optional filters:
 *   ?reportType=work_order|turn|pm|asset|evidence|assignment|cross
 *     — narrows the insights to a single Build 7.2 source family.
 */

import { Router, type IRouter } from "express";
import { runAllAnalyses } from "../services/reporting-analysis-service.js";
import { buildNarrativeInsights } from "../services/narrative-insights-engine.js";

const router: IRouter = Router();

const REPORT_TYPE_FILTERS: Record<string, (reportType: string) => boolean> = {
  work_order: (rt) => rt === "Work Order Performance",
  turn: (rt) => rt === "Turn Performance",
  pm: (rt) => rt === "Preventative Maintenance",
  asset: (rt) => rt === "Asset & Warranty",
  evidence: (rt) => rt === "Evidence & Documentation",
  assignment: (rt) => rt === "Assignment Coverage",
  cross: (rt) => rt === "Cross-Category Pressure",
};

router.get("/narrative-insights", async (req, res) => {
  try {
    const bundle = await runAllAnalyses();
    const narrative = buildNarrativeInsights(bundle);

    const filterKey = typeof req.query.reportType === "string"
      ? req.query.reportType
      : undefined;
    if (filterKey) {
      const pred = REPORT_TYPE_FILTERS[filterKey];
      if (!pred) {
        return res.status(400).json({
          error: `Unknown reportType filter '${filterKey}'. Allowed: ${Object.keys(REPORT_TYPE_FILTERS).join(", ")}`,
        });
      }
      const filtered = narrative.insights.filter((i) => pred(i.reportType));
      return res.json({ ...narrative, insights: filtered });
    }

    return res.json(narrative);
  } catch (err) {
    req.log.error({ err }, "narrative-insights failed");
    return res.status(500).json({ error: "Failed to build narrative insights" });
  }
});

export default router;
