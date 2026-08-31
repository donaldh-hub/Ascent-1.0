import { Router, type IRouter } from "express";
import { getOrCreateAccountStatus, markOnboardingCompleted, subscribe, resetAccountStatus } from "../services/account-status-service.js";
import { resetUploadCountForSession } from "../services/report-service.js";

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

// The actual start of the customer experience — trial, no upload used
// yet, onboarding not completed — restored alongside /work-orders/reset
// for work orders and DELETE /properties/:id for properties. A data-only
// reset leaves the account looking like a returning customer who already
// used their free upload and finished onboarding; this is what sends a
// reset test account back through the real first-run flow (the
// "Let's get your first report in front of Jordan" screen) instead.
router.post("/account/reset-to-first-run", async (req, res) => {
  try {
    const [accountStatus, report] = await Promise.all([
      resetAccountStatus(),
      resetUploadCountForSession(req.sessionToken),
    ]);
    res.json({ accountStatus, report });
  } catch (err) {
    res.status(500).json({ error: "Failed to reset to first-run state", detail: String(err) });
  }
});

export default router;
