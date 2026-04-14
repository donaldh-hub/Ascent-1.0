import { Router, type IRouter } from "express";
import {
  buildOperationalReport,
  buildWorkflowReport,
  buildDocumentReport,
  buildAssignmentReport,
  REPORT_REGISTRY,
  type ReportFilter,
} from "../services/reporting-service";

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

export default router;
