import type { RequestHandler } from "express";
import { and, eq, gt } from "drizzle-orm";
import type { User } from "@pm/shared";
import { db, schema } from "../db/index.js";
import { SESSION_COOKIE, hashToken } from "../lib/session.js";
import { userColumns } from "../lib/users.js";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/** Loads the current user from the session cookie, if any. */
export const loadUser: RequestHandler = async (req, _res, next) => {
  const token: string | undefined = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();

  const [row] = await db
    .select(userColumns)
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, hashToken(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);

  if (row) req.user = row;
  next();
};

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
};
