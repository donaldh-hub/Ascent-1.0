/**
 * Inbound email webhook. No specific provider (Postmark/SendGrid/Mailgun)
 * is wired yet — this accepts a normalized JSON shape directly:
 *   { messageId, fromEmail, subject?, attachments: [{ filename, contentType, contentBase64 }] }
 *
 * Whichever provider gets chosen, adapt its actual webhook payload into
 * this shape here, at the route boundary — inbound-email-service.ts stays
 * provider-agnostic. For reference: Postmark's inbound webhook posts
 * MessageID/FromFull.Email/Subject/Attachments[].Content(base64) directly
 * as JSON, closest to this shape already; SendGrid's Inbound Parse and
 * Mailgun's Routes post multipart/form-data instead and need a translation
 * step before calling processInboundEmail.
 *
 * Security: this is a machine-to-machine webhook, not a logged-in user
 * request, so there's no session/login to check. Instead it requires a
 * shared secret header — real providers also support payload-signature
 * verification (e.g. Postmark's webhook Basic Auth, SendGrid's signed
 * webhook headers); swap this for that once a provider is chosen, since a
 * shared secret alone is weaker than a per-request signature.
 */
import { Router, type IRouter } from "express";
import express from "express";
import { timingSafeEqual } from "crypto";
import { processInboundEmail, type InboundEmailInput } from "../services/inbound-email-service.js";

function secretsMatch(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false; // timingSafeEqual requires equal length
  return timingSafeEqual(a, b);
}

const router: IRouter = Router();

// Attachments arrive base64-encoded in the JSON body — the default 100kb
// express.json() limit (set globally in app.ts) would reject any
// real-sized report. This route gets its own larger parser.
const inboundEmailJsonParser = express.json({ limit: "15mb" });

router.post("/email/inbound", inboundEmailJsonParser, async (req, res) => {
  const expectedSecret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
  if (!expectedSecret) {
    res.status(503).json({ error: "Inbound email ingestion isn't configured yet." });
    return;
  }
  if (!secretsMatch(req.headers["x-inbound-webhook-secret"], expectedSecret)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const body = req.body as Partial<InboundEmailInput>;
    if (!body.messageId || !body.fromEmail || !Array.isArray(body.attachments)) {
      res.status(400).json({ error: "messageId, fromEmail, and attachments are required" });
      return;
    }

    const result = await processInboundEmail({
      messageId: body.messageId,
      fromEmail: body.fromEmail,
      subject: body.subject,
      attachments: body.attachments,
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Inbound email processing failed");
    res.status(500).json({ error: "Failed to process inbound email", detail: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
