import { Router, type IRouter } from "express";
import { RIVERSIDE_COMMONS } from "../data/riverside-commons-mock.js";
import { askLandingCoach } from "../services/landing-coach-service.js";

const router: IRouter = Router();

router.get("/landing-demo/control-tower", (_req, res) => {
  res.json({
    siteName: RIVERSIDE_COMMONS.siteName,
    woStats: RIVERSIDE_COMMONS.woStats,
    woCategoryBreakdown: RIVERSIDE_COMMONS.woCategoryBreakdown,
    turnStats: RIVERSIDE_COMMONS.turnStats,
    turns: RIVERSIDE_COMMONS.turns,
    pmTasks: RIVERSIDE_COMMONS.pmTasks,
    assets: RIVERSIDE_COMMONS.assets,
    priorityActions: RIVERSIDE_COMMONS.priorityActions,
  });
});

router.get("/landing-demo/units/:unitId", (req, res) => {
  const unit = RIVERSIDE_COMMONS.units[req.params.unitId];
  if (!unit) {
    res.status(404).json({ error: "Unit not found in demo dataset" });
    return;
  }
  res.json(unit);
});

router.post("/landing-demo/coach", async (req, res) => {
  try {
    const { question, history } = req.body ?? {};
    if (typeof question !== "string" || !question.trim()) {
      res.status(400).json({ error: "question is required" });
      return;
    }
    const answer = await askLandingCoach(question, Array.isArray(history) ? history : []);
    res.json({ answer });
  } catch (err) {
    req.log.error({ err }, "landing-demo coach failed");
    res.status(500).json({ error: "Failed to get coach response" });
  }
});

export default router;
