import type { IncomingMessage } from "node:http";
import type { CookieOptions, Request, RequestHandler } from "express";
import { isAdminRole, type SessionUser } from "@pm/shared";
import { forbidden, unauthorized } from "../../shared/errors.js";
import type { AuthService } from "./auth.service.js";

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
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

/** The session token in a raw `Cookie` header (for requests that don't go through cookie-parser). */
function sessionCookieOf(header: string | undefined): string | undefined {
  for (const pair of header?.split(";") ?? []) {
    const eq = pair.indexOf("=");
    if (eq > 0 && pair.slice(0, eq).trim() === SESSION_COOKIE) {
      try {
        return decodeURIComponent(pair.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Loads the current user from the session token, if any. */
export const loadUser =
  (auth: AuthService): RequestHandler =>
  async (req, _res, next) => {
    const token = sessionTokenOf(req);
    if (token) req.user = (await auth.authenticate(token)) ?? undefined;
    next();
  };

/**
 * The user of a WebSocket upgrade request: from `Authorization: Bearer` (mobile), else
 * from the session cookie (browsers). Browsers send cookies with WebSocket handshakes
 * started by any page, so a cookie only counts when `Origin` is this server's own host.
 */
export async function authenticateUpgrade(auth: AuthService, req: IncomingMessage): Promise<SessionUser | null> {
  const bearer = bearerTokenOf(req.headers.authorization);
  if (bearer) return auth.authenticate(bearer);
  const cookie = sessionCookieOf(req.headers.cookie);
  return cookie && isSameOrigin(req) ? auth.authenticate(cookie) : null;
}

function isSameOrigin(req: IncomingMessage): boolean {
  const { origin, host } = req.headers;
  if (!origin) return true; // not a browser
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

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
