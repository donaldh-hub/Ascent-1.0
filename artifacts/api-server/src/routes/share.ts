import { Router, type IRouter } from "express";
import { getOrCreateReportForSession, getReportByShareToken } from "../services/report-service.js";
import { sendReportEmail } from "../services/email-service.js";

const router: IRouter = Router();

router.post("/share/generate", async (req, res) => {
  try {
    const report = await getOrCreateReportForSession(req.sessionToken);
    res.json({ shareUrl: `/shared/${report.shareToken}` });
  } catch (err) {
    res.status(500).json({ error: "Failed to generate share link", detail: String(err) });
  }
});

// Public — no session/auth required. Looks up by opaque share token only.
router.get("/share/:shareToken", async (req, res) => {
  try {
    const report = await getReportByShareToken(req.params.shareToken);
    if (!report) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ siteName: report.siteName, createdAt: report.createdAt });
  } catch (err) {
    res.status(500).json({ error: "Failed to look up shared report", detail: String(err) });
  }
});

router.post("/share/email", async (req, res) => {
  try {
    const body = req.body as { to?: unknown; note?: unknown };
    const recipients = Array.isArray(body.to) ? body.to.filter((t): t is string => typeof t === "string") : [];
    if (recipients.length === 0) {
      res.status(400).json({ error: "At least one recipient email is required." });
      return;
    }
    const note = typeof body.note === "string" ? body.note : undefined;

    const report = await getOrCreateReportForSession(req.sessionToken);
    const shareUrl = `/shared/${report.shareToken}`;

    // Static placeholder summary for now — TODO: pull this from the session's
    // live analysis results once a real per-tenant data layer exists.
    const signalSummary = "Your latest upload is ready to review in the shared report.";

    for (const to of recipients) {
      await sendReportEmail({ to, senderNote: note, shareUrl, signalSummary });
    }

    res.json({ sent: false, stubbed: true, recipients });
  } catch (err) {
    res.status(500).json({ error: "Failed to queue email", detail: String(err) });
  }
});

export default router;
