import { Router, type IRouter } from "express";
import { assessLaunchReadiness } from "../services/launch-readiness-service.js";

const router: IRouter = Router();

router.get("/launch/readiness", async (_req, res) => {
  try {
    const report = await assessLaunchReadiness();
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: "launch readiness check failed", detail: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
