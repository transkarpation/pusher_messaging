import type { CookieOptions, Request, RequestHandler } from "express";
import { isAdminRole, type SessionUser } from "@pm/shared";
import { forbidden, unauthorized } from "../../shared/errors.js";
import type { AuthService } from "./auth.service.js";

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
      /** The id of the session `user` signed in with (set with it). */
      sessionId?: string;
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
export const sessionTokenOf = (req: Request): string | undefined =>
  bearerTokenOf(req.get("Authorization")) ?? req.cookies?.[SESSION_COOKIE];

/** The token of an `Authorization: Bearer <token>` header. */
const bearerTokenOf = (header: string | undefined): string | undefined =>
  header?.match(/^Bearer\s+(\S+)$/i)?.[1];

/** Loads the current user from the session token, if any. */
export const loadUser =
  (auth: AuthService): RequestHandler =>
  async (req, _res, next) => {
    const token = sessionTokenOf(req);
    const session = token ? await auth.authenticate(token) : null;
    if (session) {
      req.user = session.user;
      req.sessionId = session.sessionId;
    }
    next();
  };

export const requireAuth: RequireAuth = (req, _res, next) => {
  if (!req.user) throw unauthorized();
  next();
};

/** Lets through only admins and superadmins (anyone who manages some role). */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) throw unauthorized();
  if (!isAdminRole(req.user.role)) throw forbidden("Only administrators can do this");
  next();
};
