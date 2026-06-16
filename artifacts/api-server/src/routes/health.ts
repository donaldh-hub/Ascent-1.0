import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { runHealthCheck } from "../services/health-check-service.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/health/detailed", async (_req, res) => {
  try {
    const report = await runHealthCheck();
    const httpStatus = report.status === "down" ? 503 : report.status === "degraded" ? 207 : 200;
    res.status(httpStatus).json(report);
  } catch (err) {
    res.status(500).json({ error: "health check failed", detail: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
