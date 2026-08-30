/**
 * Inbound email ingestion — Phase 2 of the connection ladder (see
 * .agents/memory/ingestion-connection-ladder.md). A customer forwards or
 * schedules a report to an Ascent-generated address; this parses the CSV
 * or PDF attachment into rows (via pdf-report-registry.ts for PDFs — the
 * same registry the manual Upload page uses) and runs them through the
 * exact same real ingestion pipeline manual uploads use — the Data-Ingestion Agent
 * (runDataIngestionInline), which wraps importWorkOrderRows with formal
 * job tracking, an audit trail, and a handoff to the Intelligence-Quality
 * Agent — per the architectural rule that only the delivery method
 * changes, never the resolution/classification/scoring logic. This
 * previously called the simpler ingestUploadedFile(), which skips
 * per-row unit resolution and so never created real units or triggered
 * pricing recalculation for emailed reports — fixed by routing through
 * the same pipeline POST /work-orders/import uses.
 *
 * Provider-agnostic by design: `processInboundEmail` takes a normalized
 * shape, not a specific vendor's webhook payload. The route layer is
 * where a specific provider's format (Postmark, SendGrid, Mailgun, ...)
 * gets translated into this shape — see inbound-email.ts's header comment
 * for what that translation needs to do for whichever provider is chosen.
 */
import { db } from "@workspace/db";
import { inboundEmailsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getUserByEmail } from "./access-service.js";
import { parseCSV } from "./upload-ingestion-service.js";
import { parseWorkOrderReportPdf, PdfExtractionNotConfiguredError } from "./pdf-report-registry.js";
import { runDataIngestionInline, IngestionNotCompletedError } from "./agent-runtime/agents/data-ingestion-agent.js";
import { sendIngestionCompleteEmail } from "./email-service.js";

export interface InboundAttachment {
  filename: string;
  contentType: string;
  contentBase64: string;
}

export interface InboundEmailInput {
  messageId: string;
  fromEmail: string;
  subject?: string;
  attachments: InboundAttachment[];
}

export interface InboundEmailResult {
  status: "processed" | "rejected" | "duplicate" | "processing";
  reason?: string;
  ingestionResult?: Record<string, unknown>;
}

const CSV_LIKE_TYPES = ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"];
const PDF_TYPES = ["application/pdf"];

function findReportAttachment(attachments: InboundAttachment[]): InboundAttachment | null {
  return (
    attachments.find((a) => CSV_LIKE_TYPES.includes(a.contentType.toLowerCase())) ??
    attachments.find((a) => /\.csv$/i.test(a.filename)) ??
    attachments.find((a) => PDF_TYPES.includes(a.contentType.toLowerCase())) ??
    attachments.find((a) => /\.pdf$/i.test(a.filename)) ??
    null
  );
}

async function recordEmail(input: {
  messageId: string;
  fromEmail: string;
  subject?: string;
  userId: number | null;
  status: "processed" | "rejected" | "duplicate" | "processing";
  rejectionReason?: string;
  ingestionResult?: Record<string, unknown>;
}) {
  await db.insert(inboundEmailsTable).values({
    messageId: input.messageId,
    fromEmail: input.fromEmail,
    subject: input.subject,
    userId: input.userId,
    status: input.status,
    rejectionReason: input.rejectionReason,
    ingestionResult: input.ingestionResult,
  });
}

export async function processInboundEmail(input: InboundEmailInput): Promise<InboundEmailResult> {
  // 1. Duplicate ingestion guard — the DB unique constraint on messageId is
  //    the real backstop; this check just lets us return a clean, expected
  //    result instead of a constraint-violation error on a retry.
  const existing = await db
    .select({ id: inboundEmailsTable.id })
    .from(inboundEmailsTable)
    .where(eq(inboundEmailsTable.messageId, input.messageId))
    .limit(1);
  if (existing.length > 0) {
    return { status: "duplicate", reason: "This email has already been processed." };
  }

  // 2. Confirm the sender is a known user — this is what ties an inbound
  //    email to a real hub/account. An unrecognized sender is rejected,
  //    not silently attributed to nobody.
  const user = await getUserByEmail(input.fromEmail.trim().toLowerCase());
  if (!user) {
    await recordEmail({ ...input, userId: null, status: "rejected", rejectionReason: "Unrecognized sender email." });
    return { status: "rejected", reason: "Unrecognized sender email." };
  }

  // 3. Identify a usable report attachment.
  const attachment = findReportAttachment(input.attachments);
  if (!attachment) {
    await recordEmail({ ...input, userId: user.id, status: "rejected", rejectionReason: "No usable report attachment found." });
    return { status: "rejected", reason: "No usable report attachment found." };
  }

  // 4. Decode and parse the attachment (CSV or PDF) into header-keyed rows,
  //    then run those rows through the exact same resolution/governance
  //    pipeline manual uploads use — not a simpler shortcut that skips
  //    per-row property/unit resolution.
  const isPdf = attachment.contentType.toLowerCase() === "application/pdf" || /\.pdf$/i.test(attachment.filename);
  const attachmentBuffer = Buffer.from(attachment.contentBase64, "base64");

  let rows: Record<string, string>[];
  if (isPdf) {
    try {
      const parsed = await parseWorkOrderReportPdf(attachmentBuffer);
      rows = parsed.rows;
    } catch (err) {
      if (err instanceof PdfExtractionNotConfiguredError) {
        await recordEmail({ ...input, userId: user.id, status: "rejected", rejectionReason: "Unrecognized PDF format and AI-assisted extraction isn't configured." });
        return { status: "rejected", reason: "Unrecognized PDF format and AI-assisted extraction isn't configured." };
      }
      throw err;
    }
  } else {
    const fileContent = attachmentBuffer.toString("utf8");
    const { headers, rows: csvRows } = parseCSV(fileContent);
    if (headers.length === 0) {
      await recordEmail({ ...input, userId: user.id, status: "rejected", rejectionReason: "No data rows found in attachment." });
      return { status: "rejected", reason: "No data rows found in attachment." };
    }
    rows = csvRows;
  }

  if (rows.length === 0) {
    await recordEmail({ ...input, userId: user.id, status: "rejected", rejectionReason: "No data rows found in attachment." });
    return { status: "rejected", reason: "No data rows found in attachment." };
  }

  let importResult;
  try {
    importResult = await runDataIngestionInline({
      payload: { rows, sourceFileName: attachment.filename },
      organizationId: user.hubId,
      authorizedUserId: user.id,
    });
  } catch (err) {
    if (err instanceof IngestionNotCompletedError) {
      await recordEmail({ ...input, userId: user.id, status: "processing" });
      return { status: "processing", reason: "Ingestion accepted and is finishing in the background." };
    }
    throw err;
  }

  await recordEmail({
    ...input,
    userId: user.id,
    status: "processed",
    ingestionResult: importResult as unknown as Record<string, unknown>,
  });

  await sendIngestionCompleteEmail({
    to: user.email,
    fileName: attachment.filename,
    totalRows: rows.length,
  });

  return { status: "processed", ingestionResult: importResult as unknown as Record<string, unknown> };
}
