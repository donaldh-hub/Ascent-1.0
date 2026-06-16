import { Router, type IRouter } from "express";
import { getActiveNotifications } from "../services/notification-service.js";

const router: IRouter = Router();

router.get("/notifications", async (req, res) => {
  try {
    const notifications = await getActiveNotifications();
    res.json({ notifications });
  } catch (err) {
    req.log.error({ err }, "notifications fetch failed");
    res.status(500).json({ error: "Failed to fetch notifications", detail: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
