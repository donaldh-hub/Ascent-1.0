import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { sessionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sessionToken: string;
    }
  }
}

const SESSION_COOKIE = "session_token";

/**
 * Minimal anonymous-session tenancy.
 *
 * There is no real user auth in this app yet. To know "whose upload/report is
 * this" we hand every visitor an opaque random token the first time they hit
 * the upload flow, stored in an httpOnly cookie, and persist it in the
 * `sessions` table. Every report row is tagged with this token so a visitor's
 * own uploads/reports can be found again on a later visit.
 */
export async function sessionMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const cookieToken = req.cookies?.[SESSION_COOKIE] as string | undefined;

    if (cookieToken) {
      const existing = await db.select().from(sessionsTable).where(eq(sessionsTable.token, cookieToken)).limit(1);
      if (existing.length > 0) {
        req.sessionToken = cookieToken;
        return next();
      }
    }

    const token = randomUUID();
    await db.insert(sessionsTable).values({ token });
    req.sessionToken = token;
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });
    next();
  } catch (err) {
    next(err);
  }
}
