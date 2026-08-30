/**
 * Yardi Work Order PDF Parser
 *
 * Parses Yardi's "work order detail report" PDF export format — one work
 * order per form, each a label/value block (confirmed against a real
 * customer's exports: 697 real work orders across three months and four
 * properties). Text-based PDFs only (selectable text) — scanned/image
 * PDFs are not supported; that would need OCR, a separate, heavier
 * addition not built here.
 *
 * The record-boundary anchor ("Work Order No.") is Yardi's own fixed
 * template label, NOT the customer's company letterhead that also
 * appears on the page (e.g. "MP KofP Management LLC / DBA More
 * Management" in the confirmed sample) — a different Yardi customer's
 * export will show a different company name in that position, so this
 * deliberately does not key on it. This is registered under "Yardi" in
 * pdf-report-registry.ts; a different PM system's export would need its
 * own parser validated against a real sample from that system, not a
 * guess at what it might look like.
 *
 * Records are NOT one-per-page: a long problem description can push the
 * rest of a work order's fields onto a continuation page with no header
 * of its own, and short work orders can share a page. This parser works
 * off the full extracted document text and finds record boundaries by
 * the recurring "Work Order No." anchor, not by page breaks.
 *
 * A further extraction quirk (confirmed against real files, not a
 * theoretical worry): a record's own "Problem Description:" text is
 * usually positioned by the PDF's text layer BEFORE that record's own
 * header line — i.e. it shows up at the tail of the PRECEDING record's
 * text block. When a description is long enough to overflow onto a
 * continuation page, it instead appears normally, inside the record's
 * own block. This parser checks both places.
 *
 * Outputs the SAME row shape (Record<string,string>, header-keyed) that
 * extractField() / work-order-service.ts's COLUMN_ALIASES already
 * expect, so parsed PDF rows flow through the exact same
 * importWorkOrderRows() pipeline as CSV rows — no second resolution,
 * governance, or pricing code path for PDFs.
 *
 * The job-site code (e.g. "6223") is used as the property_name value fed
 * to resolveProperty() — that's how properties are identified/named in
 * this app today (see the Setup wizard's "Add units to <code>" step), not
 * by the human-readable street name that also appears in the PDF.
 */
import { PDFParse } from "pdf-parse";

export interface ParsedSite {
  siteCode: string;
  addressLines: string[];
  workOrderCount: number;
}

export interface WorkOrderPdfParseResult {
  rows: Record<string, string>[];
  sites: ParsedSite[];
  totalWorkOrders: number;
  unparsedRecords: { workOrderId?: string; reason: string }[];
}

const WORK_ORDER_HEADER = /Work Order No\.\s*\d+/g;

function match1(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  return m?.[1]?.trim() || undefined;
}

function extractRecord(
  headerBlock: string,
  prevBlock: string | undefined,
): { row: Record<string, string> | null; site: ParsedSite | null; reason?: string; workOrderId?: string } {
  const workOrderId = match1(headerBlock, /Work Order No\.\s*(\d+)/);
  if (!workOrderId) {
    return { row: null, site: null, reason: "no_work_order_number" };
  }

  const createdDate = match1(headerBlock, /Date Call:\s*([^\n]+)/);
  const completedDate = match1(headerBlock, /Date Completed:\s*([^\n]+)/);
  const scheduledDate = match1(headerBlock, /Date Scheduled:\s*([^\n]+)/);
  const statusRaw = match1(headerBlock, /(?:^|\n)Status\s+([^\n:]+?)(?:\n|$)/);
  const briefDesc = match1(headerBlock, /Brief Desc:\s*([^\n]*)/);

  // Job Site: <4-digit code>[/<unit>], followed by address lines up to the
  // next known label.
  const jobSiteMatch = headerBlock.match(
    /Job Site:\s*(\d{4})(?:\/(\S+))?\n([\s\S]*?)(?=\nCaller Name:|\nOccupant:|\nOk to enter\?|\nCategory:)/,
  );
  const siteCode = jobSiteMatch?.[1];
  const unitRaw = jobSiteMatch?.[2]?.trim();
  const addressLines = (jobSiteMatch?.[3] ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

  const categoryMatch = headerBlock.match(/Category:\s*([^\n]*?)\s*SubCategory:\s*([^\n]*)/);
  const category = categoryMatch?.[1]?.trim();
  const subCategory = categoryMatch?.[2]?.trim();

  const techMatch = headerBlock.match(
    /Technician Notes:\s*([\s\S]*?)(?=\n\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M\nPage\s*:|$)/,
  );
  const technicianNotes = techMatch?.[1]?.replace(/\s+/g, " ").trim();

  // Description: prefer one found within this record's own block (the
  // continuation-page case), else the one leaked into the tail of the
  // PRECEDING record's block (the normal case) — see file header.
  let description: string | undefined;
  const ownDesc = headerBlock.match(
    /Problem Description:\s*([\s\S]*?)(?=\nCategory:|\nParts & Labor|$)/,
  );
  if (ownDesc) {
    description = ownDesc[1].replace(/\s+/g, " ").trim();
  } else if (prevBlock) {
    const leaked = prevBlock.match(/Problem Description:\s*([\s\S]*)$/);
    if (leaked) description = leaked[1].replace(/\s+/g, " ").trim();
  }
  description = description || briefDesc || undefined;

  if (!siteCode) {
    return { row: null, site: null, reason: "no_job_site_code", workOrderId };
  }

  const category2 = category ? (subCategory ? `${category} - ${subCategory}` : category) : undefined;

  const row: Record<string, string> = {
    work_order_id: workOrderId,
    property_name: siteCode,
  };
  if (unitRaw) row.unit_number = unitRaw;
  if (category2) row.category = category2;
  if (description) row.description = description;
  if (statusRaw) row.status = statusRaw;
  if (createdDate) row.created_date = createdDate;
  if (scheduledDate) row.scheduled_date = scheduledDate;
  if (completedDate) row.completed_date = completedDate;
  if (technicianNotes) row.notes = technicianNotes;

  return { row, site: { siteCode, addressLines, workOrderCount: 1 } };
}

export async function parseWorkOrderPdf(buffer: Buffer): Promise<WorkOrderPdfParseResult> {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  const fullText = result.pages.map((p) => p.text).join("\n");

  const matches = [...fullText.matchAll(WORK_ORDER_HEADER)];
  const rows: Record<string, string>[] = [];
  const sitesByCode = new Map<string, ParsedSite>();
  const unparsedRecords: { workOrderId?: string; reason: string }[] = [];

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index!;
    const end = i + 1 < matches.length ? matches[i + 1].index! : fullText.length;
    const headerBlock = fullText.slice(start, end);
    const prevStart = i > 0 ? matches[i - 1].index! : 0;
    const prevBlock = fullText.slice(prevStart, start);

    const { row, site, reason, workOrderId } = extractRecord(headerBlock, prevBlock);
    if (!row) {
      unparsedRecords.push({ workOrderId, reason: reason ?? "unknown" });
      continue;
    }
    rows.push(row);

    if (site) {
      const existing = sitesByCode.get(site.siteCode);
      if (existing) {
        existing.workOrderCount++;
        if (existing.addressLines.length === 0 && site.addressLines.length > 0) {
          existing.addressLines = site.addressLines;
        }
      } else {
        sitesByCode.set(site.siteCode, site);
      }
    }
  }

  return {
    rows,
    sites: [...sitesByCode.values()],
    totalWorkOrders: matches.length,
    unparsedRecords,
  };
}
