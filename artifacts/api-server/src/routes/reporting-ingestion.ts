/**
 * Ascent 7.1 — Reporting Ingestion Routes
 *
 * Public surfaces for the reporting intake gate:
 *
 *   GET  /api/reporting-ingestion/sources
 *     Returns the static reporting source registry (every reportable source
 *     type with required fields, accepted resolution states, etc.).
 *
 *   GET  /api/reporting-ingestion/readiness
 *     Per-source readiness rows: total / fully / partial / not + top missing
 *     fields + recommended next action. Powers the Reporting Readiness panel.
 *
 *   GET  /api/reporting-ingestion/summary
 *     Global ingestion summary across all wired sources (spec §6).
 *
 *   GET  /api/reporting-ingestion/records?sourceType=&eligibility=
 *     Drill-down: normalized records for a single source (optionally
 *     filtered by eligibility classification).
 *
 *   POST /api/reporting-ingestion/validate?mode=strict
 *     Strict-mode wiring audit. Returns whether every wired source has at
 *     least one fully reportable record and zero unmatched residue.
 */

import { Router, type IRouter } from "express";
import {
  runReportingIngestion,
  loadRecordsForSource,
  type IngestionMode,
} from "../services/reporting-ingestion-service.js";
import {
  REPORTING_SOURCE_REGISTRY,
  listAllSourceDefinitions,
} from "../services/reporting-source-registry.js";
import type {
  ReportingSourceType,
  ReportingEligibility,
} from "../services/reporting-record-contract.js";

const router: IRouter = Router();

const VALID_SOURCES = new Set(Object.keys(REPORTING_SOURCE_REGISTRY)) as Set<string>;
const VALID_ELIGIBILITIES = new Set<ReportingEligibility>([
  "fully_reportable",
  "partially_reportable",
  "not_reportable",
]);

router.get("/reporting-ingestion/sources", (_req, res) => {
  res.json({
    sources: listAllSourceDefinitions(),
    count: listAllSourceDefinitions().length,
  });
});

router.get("/reporting-ingestion/readiness", async (_req, res) => {
  try {
    const result = await runReportingIngestion({ mode: "flexible" });
    res.json({
      generatedAt: result.generatedAt,
      readiness: result.readiness,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to compute reporting readiness", details: String(err) });
  }
});

router.get("/reporting-ingestion/summary", async (_req, res) => {
  try {
    const result = await runReportingIngestion({ mode: "flexible" });
    res.json({
      generatedAt: result.generatedAt,
      summary: result.summary,
      readiness: result.readiness,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to compute ingestion summary", details: String(err) });
  }
});

router.get("/reporting-ingestion/records", async (req, res) => {
  const sourceType = String(req.query.sourceType ?? "");
  const eligibility = req.query.eligibility ? String(req.query.eligibility) : undefined;

  if (!VALID_SOURCES.has(sourceType)) {
    res.status(400).json({ error: "Unknown sourceType", validSources: Array.from(VALID_SOURCES) });
    return;
  }
  if (eligibility && !VALID_ELIGIBILITIES.has(eligibility as ReportingEligibility)) {
    res.status(400).json({
      error: "Unknown eligibility filter",
      validEligibilities: Array.from(VALID_ELIGIBILITIES),
    });
    return;
  }

  try {
    const result = await loadRecordsForSource(sourceType as ReportingSourceType, {
      eligibility: eligibility as ReportingEligibility | undefined,
    });
    res.json({
      sourceType,
      eligibility: eligibility ?? "all",
      readiness: result.readiness,
      count: result.records.length,
      records: result.records,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load records", details: String(err) });
  }
});

const VALID_MODES = new Set<IngestionMode>(["strict", "flexible"]);

router.post("/reporting-ingestion/validate", async (req, res) => {
  // Default to strict (the audit endpoint's primary intent), but reject any
  // unknown mode value rather than silently coercing — the architect review
  // flagged silent coercion as a correctness risk.
  const modeParam = req.query.mode == null ? "strict" : String(req.query.mode);
  if (!VALID_MODES.has(modeParam as IngestionMode)) {
    res.status(400).json({
      error: "Unknown ingestion mode",
      validModes: Array.from(VALID_MODES),
    });
    return;
  }
  const mode = modeParam as IngestionMode;
  try {
    const result = await runReportingIngestion({ mode });
    res.json({
      mode: result.mode,
      generatedAt: result.generatedAt,
      strictValidation: result.strictValidation,
      summary: result.summary,
    });
  } catch (err) {
    res.status(500).json({ error: "Validation run failed", details: String(err) });
  }
});

export default router;
