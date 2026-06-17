import { Router, type IRouter } from "express";
import {
  buildOperationalReport,
  buildWorkflowReport,
  buildDocumentReport,
  buildAssignmentReport,
  REPORT_REGISTRY,
  type ReportFilter,
} from "../services/reporting-service";
import { runAllAnalyses } from "../services/reporting-analysis-service.js";
import { getOrCreateAccountStatus } from "../services/account-status-service.js";

const router: IRouter = Router();

function parseFilter(query: Record<string, unknown>): ReportFilter {
  const days = Math.min(
    Math.max(parseInt((query.days as string) ?? "30", 10) || 30, 1),
    365
  );
  const propertyId = query.propertyId ? parseInt(query.propertyId as string, 10) : undefined;
  const workflowId = query.workflowId ? parseInt(query.workflowId as string, 10) : undefined;
  return { days, propertyId, workflowId };
}

router.get("/reports", (_req, res) => {
  res.json(
    REPORT_REGISTRY.map(({ reportType, title, description, scope, category }) => ({
      reportType,
      title,
      description,
      scope,
      category,
    }))
  );
});

router.get("/reports/operational", async (req, res) => {
  try {
    const filter = parseFilter(req.query as Record<string, unknown>);
    const report = await buildOperationalReport(filter);
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Failed to generate operational report");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/reports/workflow-summary", async (req, res) => {
  try {
    const filter = parseFilter(req.query as Record<string, unknown>);
    const report = await buildWorkflowReport(filter);
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Failed to generate workflow report");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/reports/document-coverage", async (req, res) => {
  try {
    const filter = parseFilter(req.query as Record<string, unknown>);
    const report = await buildDocumentReport(filter);
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Failed to generate document report");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/reports/assignment-coverage", async (req, res) => {
  try {
    const filter = parseFilter(req.query as Record<string, unknown>);
    const report = await buildAssignmentReport(filter);
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Failed to generate assignment report");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Build 7.8 — Report Snapshot
 *
 * GET /api/reports/snapshot
 * Returns a point-in-time snapshot of the full reporting state:
 * ingestion summary + all analysis outputs + confidence states + mode.
 * Used by the frontend export panel to generate a downloadable report.
 */
router.get("/reports/snapshot", async (_req, res) => {
  try {
    const accountStatus = await getOrCreateAccountStatus();
    if (accountStatus.subscriptionStatus !== "subscribed") {
      res.status(403).json({
        error: "download_gated",
        message: "Downloading reports is included in your Ascent subscription. Start at $149/month.",
      });
      return;
    }

    const bundle = await runAllAnalyses();
    const allAnalyses = [
      ...bundle.workOrders,
      ...bundle.turns,
      ...bundle.pm,
      ...bundle.assets,
      ...bundle.evidence,
      ...bundle.assignments,
      ...bundle.crossCategory,
    ];
    res.json({
      snapshotVersion: "7.8",
      generatedAt: bundle.generatedAt,
      reportingMode: bundle.reportingMode,
      reportingModeSummary: bundle.reportingModeSummary,
      analyses: allAnalyses.map((a) => ({
        analysisId: a.analysisId,
        analysisType: a.analysisType,
        sourceCategory: a.sourceCategory,
        title: a.title,
        summary: a.summary,
        metricValue: a.metricValue,
        metricUnit: a.metricUnit,
        confidenceState: a.confidenceState,
        fullyReportableRecordCount: a.fullyReportableRecordCount,
        partiallyReportableRecordCount: a.partiallyReportableRecordCount,
        excludedRecordCount: a.excludedRecordCount,
        supportingRecordCount: a.supportingRecordCount,
        recommendedReviewQuestion: a.recommendedReviewQuestion,
      })),
      disclaimer:
        "This snapshot reflects data confidence at the time of generation. " +
        "Partial data is marked. Do not treat partial or directional analyses as confirmed operational truth.",
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to generate report snapshot", details: String(err) });
  }
});

export default router;
