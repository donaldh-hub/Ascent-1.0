import { Router, type IRouter } from "express";
import multer from "multer";
import { parseCSV } from "../services/upload-ingestion-service.js";
import { parseWorkOrderPdf, type ParsedSite } from "../services/work-order-pdf-parser.js";
import { getOrCreateReportForSession, incrementUploadCount } from "../services/report-service.js";
import { getOrCreateAccountStatus } from "../services/account-status-service.js";
import {
  runDataIngestionInline,
  IngestionNotCompletedError,
} from "../services/agent-runtime/agents/data-ingestion-agent.js";
import type { ImportRowResult, ImportWorkOrderRowsResult } from "../services/work-order-import-service.js";

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
 * A resolveProperty() "created" or "none" confidence means the row's
 * property identifier didn't match anything already in the account —
 * resolveProperty() still auto-creates a placeholder row for it (so the
 * import doesn't fail), but the existing governance layer (see
 * governance-service.ts) already excludes those rows from dashboard
 * rollups. This just makes that fact legible to a non-technical customer
 * instead of leaving it as an internal "unresolved" governance label —
 * per the explicit ask: they won't know what "unmatched property" means,
 * only that some of the report's properties aren't the location(s)
 * they've set up in Ascent.
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
    if (res.propertyConfidence !== "created" && res.propertyConfidence !== "none") continue;

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

    if (isPdf) {
      const parsed = await parseWorkOrderPdf(file.buffer);
      rows = parsed.rows;
      sites = parsed.sites;
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

    res.json({
      batchId: result.batchId,
      totalRows: rows.length,
      imported: result.imported,
      errors: result.errors,
      governance: result.governance,
      unrecognizedProperties,
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
