import { Router, type IRouter } from "express";
import { assessTrialReadiness } from "../services/trial-readiness-service.js";

const router: IRouter = Router();

router.get("/trial/readiness", async (_req, res) => {
  try {
    const report = await assessTrialReadiness();
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: "Failed to assess trial readiness", details: String(err) });
  }
});

export default router;
