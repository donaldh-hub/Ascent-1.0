/**
 * Inbound email ingestion — Phase 2 of the connection ladder (see
 * .agents/memory/ingestion-connection-ladder.md). A customer forwards or
 * schedules a report to an Ascent-generated address; this processes it
 * through the exact same upload engine manual uploads use
 * (ingestUploadedFile), per the architectural rule that only the delivery
 * method changes, never the normalization/classification/scoring logic.
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
import { ingestUploadedFile } from "./upload-ingestion-service.js";
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
  status: "processed" | "rejected" | "duplicate";
  reason?: string;
  ingestionResult?: Record<string, unknown>;
}

const CSV_LIKE_TYPES = ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"];

function findReportAttachment(attachments: InboundAttachment[]): InboundAttachment | null {
  return (
    attachments.find((a) => CSV_LIKE_TYPES.includes(a.contentType.toLowerCase())) ??
    attachments.find((a) => /\.csv$/i.test(a.filename)) ??
    null
  );
}

async function recordEmail(input: {
  messageId: string;
  fromEmail: string;
  subject?: string;
  userId: number | null;
  status: "processed" | "rejected" | "duplicate";
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

  // 4. Decode and run through the same upload engine manual uploads use.
  const fileContent = Buffer.from(attachment.contentBase64, "base64").toString("utf8");
  const ingestionResult = await ingestUploadedFile(fileContent, attachment.filename);

  await recordEmail({
    ...input,
    userId: user.id,
    status: "processed",
    ingestionResult: ingestionResult as unknown as Record<string, unknown>,
  });

  await sendIngestionCompleteEmail({
    to: user.email,
    fileName: attachment.filename,
    totalRows: ingestionResult.totalRows,
  });

  return { status: "processed", ingestionResult: ingestionResult as unknown as Record<string, unknown> };
}
