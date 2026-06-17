import { Router, type IRouter } from "express";
import { getOrCreateAccountStatus, markOnboardingCompleted, subscribe } from "../services/account-status-service.js";

const router: IRouter = Router();

router.get("/account/status", async (_req, res) => {
  try {
    const status = await getOrCreateAccountStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: "Failed to get account status", detail: String(err) });
  }
});

router.post("/account/complete-onboarding", async (_req, res) => {
  try {
    const status = await markOnboardingCompleted();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: "Failed to complete onboarding", detail: String(err) });
  }
});

router.post("/account/subscribe", async (_req, res) => {
  try {
    const status = await subscribe();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: "Failed to subscribe", detail: String(err) });
  }
});

export default router;
