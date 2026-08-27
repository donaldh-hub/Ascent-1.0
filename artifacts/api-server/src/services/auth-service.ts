import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { loginTokensTable, userSessionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const LOGIN_TOKEN_TTL_MS = 1000 * 60 * 15; // 15 minutes

export async function createLoginToken(userId: number) {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + LOGIN_TOKEN_TTL_MS);
  await db.insert(loginTokensTable).values({ userId, token, expiresAt });
  return { token, expiresAt };
}

export class InvalidLoginTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLoginTokenError";
  }
}

/** Verifies and consumes a magic-link token, returning a new user session token. */
export async function verifyLoginToken(token: string): Promise<{ sessionToken: string; userId: number }> {
  const rows = await db.select().from(loginTokensTable).where(eq(loginTokensTable.token, token)).limit(1);
  const loginToken = rows[0];

  if (!loginToken) throw new InvalidLoginTokenError("This link is invalid.");
  if (loginToken.usedAt) throw new InvalidLoginTokenError("This link has already been used.");
  if (loginToken.expiresAt.getTime() < Date.now()) throw new InvalidLoginTokenError("This link has expired.");

  await db.update(loginTokensTable).set({ usedAt: new Date() }).where(eq(loginTokensTable.id, loginToken.id));

  const sessionToken = randomUUID();
  await db.insert(userSessionsTable).values({ userId: loginToken.userId, token: sessionToken });

  return { sessionToken, userId: loginToken.userId };
}

export async function getUserIdForSession(sessionToken: string): Promise<number | null> {
  const rows = await db.select().from(userSessionsTable).where(eq(userSessionsTable.token, sessionToken)).limit(1);
  return rows[0]?.userId ?? null;
}
