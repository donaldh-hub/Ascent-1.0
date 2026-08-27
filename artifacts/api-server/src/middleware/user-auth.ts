import type { Request, Response, NextFunction } from "express";
import { getUserIdForSession } from "../services/auth-service.js";
import { getUserById, getAccessibleSiteIds } from "../services/access-service.js";
import type { User } from "@workspace/db/schema";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      accessibleSiteIds?: number[];
    }
  }
}

const USER_SESSION_COOKIE = "user_session_token";

/**
 * Attaches req.user/req.accessibleSiteIds when a valid user session cookie
 * is present. Deliberately does not reject the request when absent — this
 * app still has unauthenticated flows (the pre-account trial in
 * onboarding.tsx, the anonymous report-sharing flow); routes that require a
 * real user check `req.user` themselves and 401 if it's missing.
 */
export async function userAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[USER_SESSION_COOKIE] as string | undefined;
    if (!token) return next();

    const userId = await getUserIdForSession(token);
    if (!userId) return next();

    const user = await getUserById(userId);
    if (!user) return next();

    req.user = user;
    req.accessibleSiteIds = await getAccessibleSiteIds(userId);
    next();
  } catch (err) {
    next(err);
  }
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Login required" });
    return;
  }
  next();
}

export { USER_SESSION_COOKIE };
