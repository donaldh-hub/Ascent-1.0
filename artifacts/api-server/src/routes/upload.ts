import { Router, type IRouter } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { workOrdersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { parseCSV } from "../services/upload-ingestion-service.js";
import { parseWorkOrderReportPdf, PdfExtractionNotConfiguredError } from "../services/pdf-report-registry.js";
import type { ParsedSite } from "../services/work-order-pdf-parser.js";
import { getOrCreateReportForSession, incrementUploadCount } from "../services/report-service.js";
import { getOrCreateAccountStatus } from "../services/account-status-service.js";
import {
  runDataIngestionInline,
  IngestionNotCompletedError,
} from "../services/agent-runtime/agents/data-ingestion-agent.js";
import type { ImportRowResult, ImportWorkOrderRowsResult } from "../services/work-order-import-service.js";
import { generateIngestionSummary } from "../services/jordan-ingestion-summary.js";

const router: IRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

export interface UnrecognizedPropertyGroup {
  /** The property identifier found in the file (e.g. a job-site code) that
   * doesn't match any property already set up in this account. */
  identifier: string;
  addressLines?: string[];
  workOrderCount: number;
}

/**
 * A resolveProperty() "none" confidence means the row had no usable
 * property identifier at all — genuinely unattributable, so it's excluded
 * from dashboard rollups (see governance-service.ts). A "created"
 * confidence, by contrast, is now the primary intended path for a first
 * real upload: the report itself stood up a new property/unit from its
 * own site code, and that data is fully wired into the dashboard, not
 * held back — so it's deliberately NOT flagged here as "unrecognized."
 */
function summarizeUnrecognizedProperties(
  rows: Record<string, string>[],
  rowResults: ImportRowResult[],
  sites?: ParsedSite[],
): UnrecognizedPropertyGroup[] {
  const sitesByCode = new Map((sites ?? []).map((s) => [s.siteCode, s]));
  const groups = new Map<string, UnrecognizedPropertyGroup>();

  for (let i = 0; i < rows.length; i++) {
    const res = rowResults[i];
    const identifier = rows[i]?.property_name;
    if (!res || !identifier) continue;
    if (res.propertyConfidence !== "none") continue;

    const existing = groups.get(identifier);
    if (existing) {
      existing.workOrderCount++;
    } else {
      groups.set(identifier, {
        identifier,
        addressLines: sitesByCode.get(identifier)?.addressLines,
        workOrderCount: 1,
      });
    }
  }

  return [...groups.values()];
}

export interface ParsedUnitSite {
  siteCode: string;
  addressLines: string[];
  unitNumbers: string[];
}

/**
 * Setup-only utility: pulls the distinct unit numbers per property/site
 * out of a work order report PDF, so the initial unit-roster step can
 * take the exact same report file a customer already has — not a
 * separately-prepared CSV — same as the ask that a PDF is what people
 * will actually have, not something they should need to convert first.
 *
 * Deliberately does NOT run the ingestion pipeline, increment the free-
 * upload count, or create any work orders — this only extracts a unit
 * list for setup. The real report upload (with all its governance/
 * pricing/agent-runtime effects) still happens later at
 * POST /upload/work-orders.
 */
/**
 * Parse-only utility for the Work Orders page's own import panel
 * (work-orders.tsx's CSVUploadPanel, which predates the PDF work and
 * only ever sent pre-parsed CSV rows as JSON to POST /work-orders/import).
 * Returns the full per-work-order rows a PDF parses into — same shape
 * client-side CSV parsing already produces — so that panel can keep its
 * existing preview/column-mapping/import flow for a PDF too, instead of
 * needing a second, PDF-specific results UI. Does NOT run ingestion
 * itself; the panel still calls POST /work-orders/import afterward with
 * these rows, same as it does for a CSV today.
 */
router.post("/upload/parse-report-rows", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file provided. Send multipart/form-data with a 'file' field." });
      return;
    }
    if (!/\.pdf$/i.test(file.originalname || "")) {
      res.status(400).json({ error: "This endpoint only parses PDF reports." });
      return;
    }

    let parsed;
    try {
      parsed = await parseWorkOrderReportPdf(file.buffer);
    } catch (err) {
      if (err instanceof PdfExtractionNotConfiguredError) {
        res.status(400).json({
          error: "unrecognized_format",
          message:
            "This doesn't match a report format we recognize yet, and AI-assisted extraction for unrecognized formats isn't configured yet. Try a CSV export instead.",
        });
        return;
      }
      throw err;
    }

    if (parsed.rows.length === 0) {
      res.status(400).json({
        error: "no_data_parsed",
        message:
          "Couldn't find any work orders in this PDF. This importer expects a text-based work order detail report (not a scanned or image-only PDF).",
      });
      return;
    }

    res.json({ systemLabel: parsed.systemLabel, rows: parsed.rows });
  } catch (err) {
    req.log.error({ err }, "upload/parse-report-rows failed");
    res.status(500).json({
      error: "Failed to parse report",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post("/upload/parse-report-units", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file provided. Send multipart/form-data with a 'file' field." });
      return;
    }
    if (!/\.pdf$/i.test(file.originalname || "")) {
      res.status(400).json({ error: "This endpoint only parses PDF reports." });
      return;
    }

    let parsed;
    try {
      parsed = await parseWorkOrderReportPdf(file.buffer);
    } catch (err) {
      if (err instanceof PdfExtractionNotConfiguredError) {
        res.status(400).json({
          error: "unrecognized_format",
          message:
            "This doesn't match a report format we recognize yet, and AI-assisted extraction for unrecognized formats isn't configured yet. Try a CSV export instead.",
        });
        return;
      }
      throw err;
    }

    if (parsed.rows.length === 0) {
      res.status(400).json({
        error: "no_data_parsed",
        message:
          "Couldn't find any work orders in this PDF. This importer expects a text-based work order detail report (not a scanned or image-only PDF).",
      });
      return;
    }

    const unitsBySite = new Map<string, Set<string>>();
    for (const row of parsed.rows) {
      const siteCode = row.property_name;
      if (!siteCode || !row.unit_number) continue;
      const set = unitsBySite.get(siteCode) ?? new Set<string>();
      set.add(row.unit_number.trim());
      unitsBySite.set(siteCode, set);
    }

    const sitesByCode = new Map(parsed.sites.map((s) => [s.siteCode, s]));
    const sites: ParsedUnitSite[] = [...unitsBySite.entries()].map(([siteCode, units]) => ({
      siteCode,
      addressLines: sitesByCode.get(siteCode)?.addressLines ?? [],
      unitNumbers: [...units].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    }));

    res.json({ systemLabel: parsed.systemLabel, sites });
  } catch (err) {
    req.log.error({ err }, "upload/parse-report-units failed");
    res.status(500).json({
      error: "Failed to parse report",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post("/upload/work-orders", upload.single("file"), async (req, res) => {
  try {
    const report = await getOrCreateReportForSession(req.sessionToken);
    const accountStatus = await getOrCreateAccountStatus();
    if (report.uploadCount >= 1 && accountStatus.subscriptionStatus !== "subscribed") {
      res.status(403).json({
        error: "upload_gated",
        message:
          "Your first report is free. Ongoing uploads are included in your Ascent subscription — so your dashboard stays current every week.",
      });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file provided. Send multipart/form-data with a 'file' field." });
      return;
    }

    const fileName = file.originalname || "upload";
    const isPdf = /\.pdf$/i.test(fileName);
    const isCsv = /\.(csv|txt)$/i.test(fileName);

    if (!isPdf && !isCsv) {
      res.status(400).json({ error: "Only CSV, TXT, or PDF files are supported." });
      return;
    }

    let rows: Record<string, string>[];
    let sites: ParsedSite[] | undefined;
    let detectedSystem: string | undefined;

    if (isPdf) {
      let parsed;
      try {
        parsed = await parseWorkOrderReportPdf(file.buffer);
      } catch (err) {
        if (err instanceof PdfExtractionNotConfiguredError) {
          res.status(400).json({
            error: "unrecognized_format",
            message:
              "This doesn't match a report format we recognize yet, and AI-assisted extraction for unrecognized formats isn't configured yet. Try a CSV export instead, or let us know what system this report came from.",
          });
          return;
        }
        throw err;
      }
      rows = parsed.rows;
      sites = parsed.sites;
      detectedSystem = parsed.systemLabel;
      if (rows.length === 0) {
        res.status(400).json({
          error: "no_data_parsed",
          message:
            "Couldn't find any work orders in this PDF. This importer expects a text-based work order detail report (not a scanned or image-only PDF).",
        });
        return;
      }
    } else {
      const content = file.buffer.toString("utf8");
      const { headers, rows: csvRows } = parseCSV(content);
      if (headers.length === 0 || csvRows.length === 0) {
        res.status(400).json({ error: "No data rows found in file." });
        return;
      }
      rows = csvRows;
    }

    let result: ImportWorkOrderRowsResult;
    try {
      result = await runDataIngestionInline({
        payload: { rows, sourceFileName: fileName },
      });
    } catch (err) {
      if (err instanceof IngestionNotCompletedError) {
        res.status(202).json({
          status: "processing",
          message: "Your report was accepted and is still being processed. Check back shortly.",
        });
        return;
      }
      throw err;
    }

    await incrementUploadCount(req.sessionToken);

    const unrecognizedProperties = summarizeUnrecognizedProperties(rows, result.results, sites);

    // Jordan's take on this upload — grounded synthesis, not a hard
    // dependency of the import itself. A missing API key or a model
    // hiccup should never turn a successful import into a failed
    // response; it just means no summary this time.
    let jordanSummary: { headline: string; recommendations: string[] } | null = null;
    try {
      const touchedProperties = await db
        .selectDistinct({ propertyId: workOrdersTable.propertyId })
        .from(workOrdersTable)
        .where(eq(workOrdersTable.importBatchId, result.batchId));
      const propertyIds = touchedProperties
        .map((r) => r.propertyId)
        .filter((id): id is number => id != null);
      if (propertyIds.length > 0) {
        jordanSummary = await generateIngestionSummary({ batchId: result.batchId, propertyIds });
      }
    } catch (err) {
      req.log.warn({ err }, "Jordan ingestion summary failed — continuing without it");
    }

    res.json({
      batchId: result.batchId,
      totalRows: rows.length,
      imported: result.imported,
      errors: result.errors,
      governance: result.governance,
      unrecognizedProperties,
      detectedSystem,
      jordanSummary,
    });
  } catch (err) {
    req.log.error({ err }, "upload/work-orders failed");
    res.status(500).json({
      error: "Upload failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
