import { Router, type Response } from "express";
import { authRequestSchema, type TokenAuthResponse } from "@pm/shared";
import { parse } from "../../shared/http.js";
import { SESSION_COOKIE, sessionCookieOptions, sessionTokenOf } from "./auth.middleware.js";
import type { AuthService, Session } from "./auth.service.js";

/**
 * /api/auth: sign up, sign in, sign out, who am I. The session lives in an httpOnly cookie
 * (web), or its token is returned to send as a Bearer header (`session: "token"`, mobile).
 */
export function authRoutes(auth: AuthService) {
  const router = Router();

  /** Hands the new session to the client the way it asked for. */
  const respond = (res: Response, kind: "cookie" | "token", session: Session, status: number) => {
    if (kind === "token") {
      const body: TokenAuthResponse = { user: session.user, token: session.token, expiresAt: session.expiresAt.toISOString() };
      res.status(status).json(body);
      return;
    }
    res.cookie(SESSION_COOKIE, session.token, { ...sessionCookieOptions, expires: session.expiresAt });
    res.status(status).json({ user: session.user });
  };

  router.get("/me", (req, res) => {
    res.json({ user: req.user ?? null });
  });

  router.post("/register", async (req, res) => {
    const { session: kind, ...credentials } = parse(authRequestSchema, req.body);
    respond(res, kind, await auth.register(credentials), 201);
  });

  router.post("/login", async (req, res) => {
    const { session: kind, ...credentials } = parse(authRequestSchema, req.body);
    respond(res, kind, await auth.login(credentials), 200);
  });

  /** Ends the session of the Bearer token, or of the cookie. */
  router.post("/logout", async (req, res) => {
    await auth.logout(sessionTokenOf(req));
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions);
    res.status(204).end();
  });

  return router;
}
