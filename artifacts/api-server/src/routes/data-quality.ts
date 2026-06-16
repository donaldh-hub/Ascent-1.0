import { Router, type IRouter } from "express";
import { runDataQualityCheck } from "../services/data-quality-service.js";

const router: IRouter = Router();

router.get("/data-quality/check", async (req, res) => {
  try {
    const report = await runDataQualityCheck();
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "data quality check failed");
    res.status(500).json({ error: "Failed to run data quality check", detail: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
