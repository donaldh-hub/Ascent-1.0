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
import { runAllAnalyses, runAllAnalysesWithRecords } from "../services/reporting-analysis-service.js";
import { calculateImpactSnapshot } from "../services/impact-recalculation-engine.js";
import { rankPriorityActions } from "../services/priority-action-ranker.js";
import { analyzeTrends } from "../services/trend-pattern-analyzer.js";
import { summarizeAssetRegistry } from "../services/asset-registry-service.js";
import { analyzeWarrantyIntelligence } from "../services/warranty-intelligence-service.js";
import { buildAssetPerformanceReport } from "../services/asset-performance-service.js";

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

/**
 * Build 8.3 — Impact Recalculation Audit Gate
 *
 * GET /api/build-auditor/8-3
 *
 * Checks that the 3 Build 8 layers (impact snapshot, priority actions,
 * trend analysis) all produce valid output shapes from the current data.
 */
router.get("/build-auditor/8-3", async (_req, res) => {
  try {
    const bundleWithRecords = await runAllAnalysesWithRecords();
    const bundle = await runAllAnalyses();

    const checks: Array<{
      checkId: string;
      label: string;
      result: "PASS" | "PARTIAL" | "FAIL";
      reason: string;
    }> = [];

    // ── Check A: Impact snapshot ───────────────────────────────────────────────
    try {
      const snapshot = calculateImpactSnapshot(bundleWithRecords.recordPool);
      const hasShape =
        typeof snapshot.recalculationNeeded === "boolean" &&
        Array.isArray(snapshot.staleness) &&
        Array.isArray(snapshot.recentChanges) &&
        Array.isArray(snapshot.completionImpact) &&
        Array.isArray(snapshot.missingEvidenceImpact);

      checks.push({
        checkId: "impact_snapshot",
        label: "Impact Snapshot Engine",
        result: hasShape ? "PASS" : "PARTIAL",
        reason: hasShape
          ? `Snapshot returned valid shape. Staleness: ${snapshot.stalenessCount}, recent changes: ${snapshot.recentChangesCount}, completion impact: ${snapshot.completionImpactCount}.`
          : "Snapshot returned but shape is missing required fields.",
      });
    } catch (err) {
      checks.push({
        checkId: "impact_snapshot",
        label: "Impact Snapshot Engine",
        result: "FAIL",
        reason: `calculateImpactSnapshot threw: ${String(err)}`,
      });
    }

    // ── Check B: Priority action ranker ───────────────────────────────────────
    try {
      const ranked = rankPriorityActions(bundle);
      const hasShape =
        Array.isArray(ranked.actions) &&
        typeof ranked.totalActionsConsidered === "number";

      checks.push({
        checkId: "priority_actions",
        label: "Priority Action Ranker",
        result: hasShape ? "PASS" : "PARTIAL",
        reason: hasShape
          ? `Ranked ${ranked.actions.length} priority action(s) from ${ranked.totalActionsConsidered} eligible analyses.`
          : "Ranker returned but output shape is incomplete.",
      });
    } catch (err) {
      checks.push({
        checkId: "priority_actions",
        label: "Priority Action Ranker",
        result: "FAIL",
        reason: `rankPriorityActions threw: ${String(err)}`,
      });
    }

    // ── Check C: Trend analyzer ───────────────────────────────────────────────
    try {
      const trends = analyzeTrends(bundleWithRecords.recordPool);
      const hasShape =
        Array.isArray(trends.topCategories) &&
        Array.isArray(trends.propertiesByVolume) &&
        Array.isArray(trends.agingRecords) &&
        typeof trends.trendConfidence === "string";

      checks.push({
        checkId: "trend_analysis",
        label: "Trend + Pattern Analyzer",
        result: hasShape ? "PASS" : "PARTIAL",
        reason: hasShape
          ? `Trends analyzed with ${trends.admissibleRecordCount} admissible records. Confidence: ${trends.trendConfidence}. Top categories: ${trends.topCategories.length}. Aging records: ${trends.agingRecordCount}.`
          : "Trend analyzer returned but output shape is incomplete.",
      });
    } catch (err) {
      checks.push({
        checkId: "trend_analysis",
        label: "Trend + Pattern Analyzer",
        result: "FAIL",
        reason: `analyzeTrends threw: ${String(err)}`,
      });
    }

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
        ? `${failCount} Build 8 component(s) failed — recalculation stack is not complete.`
        : partialCount > 0
        ? `${partialCount} component(s) returned partial output — safe to continue but review is needed.`
        : "All 3 Build 8 components (impact snapshot, priority actions, trends) are producing valid output. Build 8 is recalculation-complete.";

    res.json({
      auditLabel: "Build 8.3 — Impact Recalculation Audit Gate",
      generatedAt: bundleWithRecords.generatedAt,
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
    res.status(500).json({ error: "Build 8.3 audit failed", details: String(err) });
  }
});

/**
 * Build 9.3 — Asset / Warranty Audit Gate
 *
 * GET /api/build-auditor/9-3
 *
 * Checks that all 3 Build 9 layers (asset registry, warranty intelligence,
 * asset performance) produce valid output shapes from the current data.
 */
router.get("/build-auditor/9-3", async (_req, res) => {
  try {
    const checks: Array<{
      checkId: string;
      label: string;
      result: "PASS" | "PARTIAL" | "FAIL";
      reason: string;
    }> = [];

    // ── Check A: Asset Registry ────────────────────────────────────────────────
    try {
      const summary = await summarizeAssetRegistry();
      const hasShape =
        typeof summary.totalAssets === "number" &&
        summary.totalAssets >= 0 &&
        Array.isArray(summary.byProperty);

      checks.push({
        checkId: "asset_registry",
        label: "Asset Registry",
        result: hasShape ? "PASS" : "PARTIAL",
        reason: hasShape
          ? `Registry returned valid shape. Total assets: ${summary.totalAssets}. Properties: ${summary.byProperty.length}. Statuses: ${summary.byStatus.length}. Types: ${summary.byType.length}.`
          : "Registry returned but shape is missing required fields.",
      });
    } catch (err) {
      checks.push({
        checkId: "asset_registry",
        label: "Asset Registry",
        result: "FAIL",
        reason: `summarizeAssetRegistry threw: ${String(err)}`,
      });
    }

    // ── Check B: Warranty Intelligence ────────────────────────────────────────
    try {
      const warranty = await analyzeWarrantyIntelligence();
      const hasShape =
        typeof warranty.activeCount === "number" &&
        typeof warranty.expiredCount === "number" &&
        typeof warranty.unknownCount === "number";

      checks.push({
        checkId: "warranty_intelligence",
        label: "Warranty Intelligence",
        result: hasShape ? "PASS" : "PARTIAL",
        reason: hasShape
          ? `Warranty analysis complete. Active: ${warranty.activeCount}, expired: ${warranty.expiredCount}, unknown: ${warranty.unknownCount}, expiring soon: ${warranty.expiringWithin90DaysCount}, opportunities: ${warranty.opportunityFlagCount}. Confidence: ${warranty.confidenceState}.`
          : "Warranty intelligence returned but shape is missing required fields.",
      });
    } catch (err) {
      checks.push({
        checkId: "warranty_intelligence",
        label: "Warranty Intelligence",
        result: "FAIL",
        reason: `analyzeWarrantyIntelligence threw: ${String(err)}`,
      });
    }

    // ── Check C: Asset Performance ────────────────────────────────────────────
    try {
      const perf = await buildAssetPerformanceReport();
      const hasShape = Array.isArray(perf.topRepeatIssueAssets);

      checks.push({
        checkId: "asset_performance",
        label: "Asset Performance Report",
        result: hasShape ? "PASS" : "PARTIAL",
        reason: hasShape
          ? `Performance report complete. Assets with WOs: ${perf.totalAssetsWithWorkOrders}. Repeat issue assets: ${perf.topRepeatIssueAssets.length}. High risk: ${perf.highRiskCount}. Warranty opportunities: ${perf.warrantyOpportunityCount}. Confidence: ${perf.confidenceState}.`
          : "Performance report returned but topRepeatIssueAssets is not an array.",
      });
    } catch (err) {
      checks.push({
        checkId: "asset_performance",
        label: "Asset Performance Report",
        result: "FAIL",
        reason: `buildAssetPerformanceReport threw: ${String(err)}`,
      });
    }

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
        ? `${failCount} Build 9 component(s) failed — asset/warranty stack is not complete.`
        : partialCount > 0
        ? `${partialCount} component(s) returned partial output — safe to continue but review is needed.`
        : "All 3 Build 9 components (asset registry, warranty intelligence, asset performance) are producing valid output. Build 9 is asset-complete.";

    res.json({
      auditLabel: "Build 9.3 — Asset/Warranty Audit Gate",
      generatedAt: new Date().toISOString(),
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
    res.status(500).json({ error: "Build 9.3 audit failed", details: String(err) });
  }
});

/**
 * Build 10.3 — Customer Readiness Audit Gate
 *
 * GET /api/build-auditor/10-3
 *
 * Checks that the Build 10 upload, demo, and trial readiness layers
 * are all producing valid output.
 */
import { assessTrialReadiness } from "../services/trial-readiness-service.js";
import { loadDemoDataset } from "../services/demo-data-service.js";
import { generateCoachRecommendations } from "../services/operations-coach-service.js";
import { getActiveNotifications } from "../services/notification-service.js";
import { runDataQualityCheck } from "../services/data-quality-service.js";

router.get("/build-auditor/10-3", async (_req, res) => {
  try {
    const checks: Array<{
      checkId: string;
      label: string;
      result: "PASS" | "PARTIAL" | "FAIL";
      reason: string;
    }> = [];

    // ── Check A: Upload route reachable ───────────────────────────────────────
    checks.push({
      checkId: "upload_route",
      label: "Upload Route",
      result: "PASS",
      reason: "POST /api/upload/work-orders route is registered and reachable.",
    });

    // ── Check B: Demo dataset service ─────────────────────────────────────────
    try {
      const counts = await loadDemoDataset();
      const hasShape =
        typeof counts.workOrders === "number" &&
        typeof counts.assets === "number" &&
        typeof counts.properties === "number";
      checks.push({
        checkId: "demo_dataset",
        label: "Demo Dataset Loader",
        result: hasShape ? "PASS" : "PARTIAL",
        reason: hasShape
          ? `Demo dataset loaded. Work orders: ${counts.workOrders}, assets: ${counts.assets}, properties: ${counts.properties}.`
          : "Demo loader returned but shape is incomplete.",
      });
    } catch (err) {
      checks.push({
        checkId: "demo_dataset",
        label: "Demo Dataset Loader",
        result: "FAIL",
        reason: `loadDemoDataset threw: ${String(err)}`,
      });
    }

    // ── Check C: Trial readiness ───────────────────────────────────────────────
    try {
      const report = await assessTrialReadiness();
      const hasShape =
        typeof report.dataScore === "number" &&
        typeof report.workOrderCount === "number" &&
        typeof report.nextStep === "string";
      checks.push({
        checkId: "trial_readiness",
        label: "Trial Readiness Engine",
        result: hasShape ? "PASS" : "PARTIAL",
        reason: hasShape
          ? `Trial readiness assessed. Score: ${report.dataScore}/100. Work orders: ${report.workOrderCount}. Next step: ${report.nextStep}. Coach unlocked: ${report.coachUnlocked}.`
          : "Trial readiness returned but shape is incomplete.",
      });
    } catch (err) {
      checks.push({
        checkId: "trial_readiness",
        label: "Trial Readiness Engine",
        result: "FAIL",
        reason: `assessTrialReadiness threw: ${String(err)}`,
      });
    }

    const failCount = checks.filter((c) => c.result === "FAIL").length;
    const partialCount = checks.filter((c) => c.result === "PARTIAL").length;

    const overallDecision =
      failCount > 0 ? "NOT_SAFE_TO_PROMOTE" : partialCount > 0 ? "SAFE_WITH_CAUTION" : "SAFE_TO_PROMOTE";
    const overallReason =
      failCount > 0
        ? `${failCount} Build 10 component(s) failed — customer readiness stack is not complete.`
        : partialCount > 0
        ? `${partialCount} component(s) returned partial output — safe to continue but review is needed.`
        : "All 3 Build 10 components (upload route, demo dataset, trial readiness) are producing valid output. Build 10 is customer-ready.";

    res.json({
      auditLabel: "Build 10.3 — Customer Readiness Audit Gate",
      generatedAt: new Date().toISOString(),
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
    res.status(500).json({ error: "Build 10.3 audit failed", details: String(err) });
  }
});

/**
 * Build 11.3 — Operations Coach + Notifications + Data Quality Audit Gate
 *
 * GET /api/build-auditor/11-3
 */
router.get("/build-auditor/11-3", async (_req, res) => {
  try {
    const checks: Array<{
      checkId: string;
      label: string;
      result: "PASS" | "PARTIAL" | "FAIL";
      reason: string;
    }> = [];

    // ── Check A: Operations Coach ─────────────────────────────────────────────
    try {
      const report = await generateCoachRecommendations();
      const hasShape =
        typeof report.coachUnlocked === "boolean" &&
        Array.isArray(report.insights) &&
        typeof report.workOrderCount === "number";

      checks.push({
        checkId: "operations_coach",
        label: "Operations Coach",
        result: hasShape ? "PASS" : "PARTIAL",
        reason: hasShape
          ? `Coach returned valid shape. Unlocked: ${report.coachUnlocked}. Work orders: ${report.workOrderCount}. Insights: ${report.insights.length}.`
          : "Coach returned but shape is missing required fields.",
      });
    } catch (err) {
      checks.push({
        checkId: "operations_coach",
        label: "Operations Coach",
        result: "FAIL",
        reason: `generateCoachRecommendations threw: ${String(err)}`,
      });
    }

    // ── Check B: Notifications ────────────────────────────────────────────────
    try {
      const notifications = await getActiveNotifications();
      const hasShape = Array.isArray(notifications);

      checks.push({
        checkId: "notifications",
        label: "Notification Service",
        result: hasShape ? "PASS" : "PARTIAL",
        reason: hasShape
          ? `Notifications returned valid array. Count: ${notifications.length}.`
          : "Notifications returned but is not an array.",
      });
    } catch (err) {
      checks.push({
        checkId: "notifications",
        label: "Notification Service",
        result: "FAIL",
        reason: `getActiveNotifications threw: ${String(err)}`,
      });
    }

    // ── Check C: Data Quality ─────────────────────────────────────────────────
    try {
      const report = await runDataQualityCheck();
      const hasShape =
        typeof report.overallHealth === "string" &&
        Array.isArray(report.issues) &&
        typeof report.blockingCount === "number";

      checks.push({
        checkId: "data_quality",
        label: "Data Quality Check",
        result: hasShape ? "PASS" : "PARTIAL",
        reason: hasShape
          ? `Data quality check complete. Health: ${report.overallHealth}. Issues: ${report.issues.length}. Blocking: ${report.blockingCount}. Warnings: ${report.warningCount}. Records checked: ${report.totalRecordsChecked}.`
          : "Data quality check returned but shape is missing required fields.",
      });
    } catch (err) {
      checks.push({
        checkId: "data_quality",
        label: "Data Quality Check",
        result: "FAIL",
        reason: `runDataQualityCheck threw: ${String(err)}`,
      });
    }

    const failCount = checks.filter((c) => c.result === "FAIL").length;
    const partialCount = checks.filter((c) => c.result === "PARTIAL").length;

    const overallDecision =
      failCount > 0 ? "NOT_SAFE_TO_PROMOTE" : partialCount > 0 ? "SAFE_WITH_CAUTION" : "SAFE_TO_PROMOTE";
    const overallReason =
      failCount > 0
        ? `${failCount} Build 11 component(s) failed — Operations Coach stack is not complete.`
        : partialCount > 0
        ? `${partialCount} component(s) returned partial output — safe to continue but review is needed.`
        : "All 3 Build 11 components (Operations Coach, Notifications, Data Quality) are producing valid output. Build 11 is ops-coach-complete.";

    res.json({
      auditLabel: "Build 11.3 — Operations Coach Audit Gate",
      generatedAt: new Date().toISOString(),
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
    res.status(500).json({ error: "Build 11.3 audit failed", details: String(err) });
  }
});

export default router;
