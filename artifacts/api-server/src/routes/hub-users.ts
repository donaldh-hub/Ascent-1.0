import { Router, type IRouter } from "express";
import { requireUser } from "../middleware/user-auth.js";
import {
  createUser,
  getUserByEmail,
  listHubUsers,
  grantSiteAccess,
  revokeSiteAccess,
  getAccessibleSites,
  AccessDeniedError,
} from "../services/access-service.js";

const router: IRouter = Router();

router.get("/hub/users", requireUser, async (req, res) => {
  const users = await listHubUsers(req.user!.hubId);
  res.json({ users });
});

router.get("/hub/sites", requireUser, async (req, res) => {
  const sites = await getAccessibleSites(req.user!.id);
  res.json({ sites });
});

router.post("/hub/users", requireUser, async (req, res) => {
  try {
    if (!req.user!.canManageAccess) {
      res.status(403).json({ error: "You do not have permission to add users." });
      return;
    }

    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const name = req.body?.name ? String(req.body.name) : undefined;
    const role = req.body?.role ? String(req.body.role) : undefined;
    if (!email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const existing = await getUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: "A user with this email already exists." });
      return;
    }

    const user = await createUser({ hubId: req.user!.hubId, email, name, role });
    res.status(201).json({ user });
  } catch (err) {
    res.status(500).json({ error: "Failed to create user", detail: String(err) });
  }
});

router.post("/hub/users/:userId/site-access/:siteId", requireUser, async (req, res) => {
  try {
    const targetUserId = Number(req.params.userId);
    const siteId = Number(req.params.siteId);
    const grant = await grantSiteAccess({ granterUserId: req.user!.id, targetUserId, siteId });
    res.status(201).json({ grant });
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      res.status(403).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "Failed to grant site access", detail: String(err) });
  }
});

router.delete("/hub/users/:userId/site-access/:siteId", requireUser, async (req, res) => {
  try {
    const targetUserId = Number(req.params.userId);
    const siteId = Number(req.params.siteId);
    await revokeSiteAccess({ granterUserId: req.user!.id, targetUserId, siteId });
    res.json({ revoked: true });
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      res.status(403).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "Failed to revoke site access", detail: String(err) });
  }
});

export default router;
