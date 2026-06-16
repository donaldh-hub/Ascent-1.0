import { Router, type IRouter } from "express";
import { generateCoachRecommendations } from "../services/operations-coach-service.js";
import { generateWeeklySummary, getLastWeeklySummary } from "../services/weekly-summary-engine.js";
import { getOrCreatePreferences, updatePreferences } from "../services/coach-preference-service.js";

const router: IRouter = Router();

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

export default router;
