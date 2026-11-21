import { createHash, randomBytes } from "node:crypto";
import type { CookieOptions, Response } from "express";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export const SESSION_COOKIE = "sid";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(res: Response, userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(schema.sessions).values({ id: hashToken(token), userId, expiresAt });
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
}

export async function destroySession(res: Response, token: string | undefined) {
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, hashToken(token)));
  res.clearCookie(SESSION_COOKIE, cookieOptions);
}
