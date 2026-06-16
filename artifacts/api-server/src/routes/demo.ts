import { Router, type IRouter } from "express";
import { loadDemoDataset, clearDemoDataset } from "../services/demo-data-service.js";

const router: IRouter = Router();

router.post("/demo/load", async (_req, res) => {
  try {
    const counts = await loadDemoDataset();
    res.json({ success: true, ...counts });
  } catch (err) {
    res.status(500).json({ error: "Failed to load demo data", details: String(err) });
  }
});

router.delete("/demo/clear", async (_req, res) => {
  try {
    const result = await clearDemoDataset();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: "Failed to clear demo data", details: String(err) });
  }
});

export default router;
