import type { CookieOptions, Request, RequestHandler } from "express";
import type { User } from "@pm/shared";
import { unauthorized } from "../../shared/errors.js";
import type { AuthService } from "./auth.service.js";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export const SESSION_COOKIE = "sid";

export const sessionCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export type RequireAuth = RequestHandler;

/**
 * The session token of a request: `Authorization: Bearer <token>` (mobile and other
 * non-browser clients), else the session cookie (the web client).
 */
export const sessionTokenOf = (req: Request): string | undefined => {
  const header = req.get("Authorization");
  const bearer = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  return bearer ?? req.cookies?.[SESSION_COOKIE];
};

/** Loads the current user from the session token, if any. */
export const loadUser =
  (auth: AuthService): RequestHandler =>
  async (req, _res, next) => {
    const token = sessionTokenOf(req);
    if (token) req.user = (await auth.authenticate(token)) ?? undefined;
    next();
  };

export const requireAuth: RequireAuth = (req, _res, next) => {
  if (!req.user) throw unauthorized();
  next();
};
