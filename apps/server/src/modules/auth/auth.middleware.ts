import type { CookieOptions, RequestHandler } from "express";
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

/** Loads the current user from the session cookie, if any. */
export const loadUser =
  (auth: AuthService): RequestHandler =>
  async (req, _res, next) => {
    const token: string | undefined = req.cookies?.[SESSION_COOKIE];
    if (token) req.user = (await auth.authenticate(token)) ?? undefined;
    next();
  };

export const requireAuth: RequireAuth = (req, _res, next) => {
  if (!req.user) throw unauthorized();
  next();
};
