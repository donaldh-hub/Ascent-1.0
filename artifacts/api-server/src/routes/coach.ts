import { Router, type IRouter } from "express";
import { generateCoachRecommendations } from "../services/operations-coach-service.js";

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

export default router;
