/**
 * PDF report format registry — one entry point for turning any PM
 * system's work order report PDF into rows, regardless of which system
 * produced it.
 *
 * Every report carries the same fundamental information (a property, a
 * unit, what needs to be done, what was done) — but each PM system lays
 * it out differently. This registry tries known, deterministic,
 * zero-cost parsers first (validated against a real export from that
 * system — see work-order-pdf-parser.ts for Yardi, the only one
 * registered so far), and only falls back to AI-assisted extraction
 * (claude-pdf-extractor.ts) for a format nothing here recognizes.
 *
 * Adding a new deterministic entry requires a real sample from that
 * system to validate against — never a guessed format.
 */
import { PDFParse } from "pdf-parse";
import { parseWorkOrderPdf, type ParsedSite } from "./work-order-pdf-parser.js";
import { extractWorkOrdersWithClaude, PdfExtractionNotConfiguredError } from "./claude-pdf-extractor.js";

export { PdfExtractionNotConfiguredError };

export interface PdfReportParseResult {
  /** Which system's format this was recognized as, or how it was handled. */
  systemLabel: string;
  aiAssisted: boolean;
  rows: Record<string, string>[];
  sites: ParsedSite[];
}

export async function parseWorkOrderReportPdf(buffer: Buffer): Promise<PdfReportParseResult> {
  const yardi = await parseWorkOrderPdf(buffer);
  if (yardi.totalWorkOrders > 0) {
    return { systemLabel: "Yardi", aiAssisted: false, rows: yardi.rows, sites: yardi.sites };
  }

  // No known deterministic parser recognized this file — fall back to
  // AI-assisted extraction of the same fundamental fields from the raw
  // text. Throws PdfExtractionNotConfiguredError if that isn't set up,
  // which callers should surface as a clear, honest message rather than
  // a generic failure.
  const parser = new PDFParse({ data: buffer });
  const parsed = await parser.getText();
  const fullText = parsed.pages.map((p) => p.text).join("\n");
  const { rows } = await extractWorkOrdersWithClaude(fullText);

  return { systemLabel: "Unrecognized format (AI-assisted extraction)", aiAssisted: true, rows, sites: [] };
}
