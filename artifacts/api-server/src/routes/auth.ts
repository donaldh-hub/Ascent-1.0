import { Router, type IRouter } from "express";
import { getUserByEmail } from "../services/access-service.js";
import { createLoginToken, verifyLoginToken, InvalidLoginTokenError } from "../services/auth-service.js";
import { sendMagicLinkEmail } from "../services/email-service.js";
import { USER_SESSION_COOKIE } from "../middleware/user-auth.js";

const router: IRouter = Router();

router.post("/auth/request-link", async (req, res) => {
  try {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const user = await getUserByEmail(email);
    // Do not reveal whether the email is registered — same response either way.
    if (!user) {
      res.json({ sent: true });
      return;
    }

    const { token } = await createLoginToken(user.id);
    const baseUrl = process.env.ENGINE_PUBLIC_URL ?? `${req.protocol}://${req.get("host")}`;
    const loginUrl = `${baseUrl}/api/auth/verify?token=${token}`;
    const result = await sendMagicLinkEmail({ to: email, loginUrl });

    res.json({ sent: true, ...(result.stubbed ? { stubbed: true, loginUrl } : {}) });
  } catch (err) {
    res.status(500).json({ error: "Failed to send login link", detail: String(err) });
  }
});

router.get("/auth/verify", async (req, res) => {
  try {
    const token = String(req.query.token ?? "");
    const { sessionToken } = await verifyLoginToken(token);

    res.cookie(USER_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });
    res.redirect("/");
  } catch (err) {
    if (err instanceof InvalidLoginTokenError) {
      res.status(400).send(err.message);
      return;
    }
    res.status(500).json({ error: "Failed to verify login link", detail: String(err) });
  }
});

router.get("/auth/me", async (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Not logged in" });
    return;
  }
  res.json({ user: req.user, accessibleSiteIds: req.accessibleSiteIds ?? [] });
});

router.post("/auth/logout", async (req, res) => {
  res.clearCookie(USER_SESSION_COOKIE);
  res.json({ loggedOut: true });
});

export default router;
