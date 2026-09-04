import { Router, type IRouter } from "express";
import { generateCoachRecommendations } from "../services/operations-coach-service.js";
import { generateWeeklySummary, getLastWeeklySummary } from "../services/weekly-summary-engine.js";
import { getLatestIngestionSummary } from "../services/jordan-ingestion-summary.js";
import { getOrCreatePreferences, updatePreferences } from "../services/coach-preference-service.js";
import { JordanNotConfiguredError } from "../services/jordan-chat-service.js";
import { runJordanMessageInline, JordanJobNotCompletedError } from "../services/agent-runtime/agents/jordan-agent.js";
import { getOrCreateDefaultUser } from "../services/access-service.js";

const router: IRouter = Router();

router.post("/coach/chat", async (req, res) => {
  try {
    const message = String(req.body?.message ?? "").trim();
    if (!message) {
      res.status(400).json({ error: "Message is required" });
      return;
    }
    const conversationId = typeof req.body?.conversationId === "number" ? req.body.conversationId : undefined;

    // No real login flow exists yet (see session.ts) — a real logged-in
    // user gets their own granted-sites scope as before; anyone else
    // (today, everyone) falls back to this single-tenant deployment's
    // one default identity with unrestricted access, rather than a 401
    // that permanently blocks the feature this app actually advertises.
    const userId = req.user ? req.user.id : (await getOrCreateDefaultUser()).id;
    const accessibleSiteIds = req.user ? (req.accessibleSiteIds ?? []) : undefined;

    const result = await runJordanMessageInline({
      userId,
      accessibleSiteIds,
      conversationId,
      message,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof JordanNotConfiguredError) {
      res.status(503).json({ error: err.message });
      return;
    }
    if (err instanceof JordanJobNotCompletedError) {
      res.status(202).json({ status: "processing", detail: err.message });
      return;
    }
    req.log.error({ err }, "Jordan chat failed");
    res.status(500).json({ error: "Failed to get a response from Jordan", detail: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/coach/recommendations", async (req, res) => {
  try {
    const report = await generateCoachRecommendations();
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "coach recommendations failed");
    res.status(500).json({ error: "Failed to generate coach recommendations", detail: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/coach/preferences", async (_req, res) => {
  try {
    const prefs = await getOrCreatePreferences();
    res.json(prefs);
  } catch (err) {
    res.status(500).json({ error: "Failed to get preferences", detail: String(err) });
  }
});

router.patch("/coach/preferences", async (req, res) => {
  try {
    const { coachName, communicationStyle, pillarOrder, activationCompleted } = req.body ?? {};
    const prefs = await updatePreferences({ coachName, communicationStyle, pillarOrder, activationCompleted });
    res.json(prefs);
  } catch (err) {
    res.status(500).json({ error: "Failed to update preferences", detail: String(err) });
  }
});

router.get("/coach/weekly-summary", async (req, res) => {
  try {
    const summary = await generateWeeklySummary();
    res.json(summary);
  } catch (err) {
    req.log.error({ err }, "weekly summary failed");
    res.status(500).json({ error: "Failed to generate weekly summary", detail: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/coach/weekly-summary/last", async (_req, res) => {
  try {
    const last = await getLastWeeklySummary();
    if (!last) return res.status(404).json({ error: "No prior summary found" });
    res.json(last);
  } catch (err) {
    res.status(500).json({ error: "Failed to retrieve last summary", detail: String(err) });
  }
});

router.get("/coach/ingestion-summary/latest", async (_req, res) => {
  try {
    const latest = await getLatestIngestionSummary();
    if (!latest) return res.status(404).json({ error: "No upload summary found yet" });
    res.json(latest);
  } catch (err) {
    res.status(500).json({ error: "Failed to retrieve latest upload summary", detail: String(err) });
  }
});

export default router;
