import { Router, type Response } from "express";
import { credentialsSchema } from "@pm/shared";
import { parse } from "../../shared/http.js";
import { SESSION_COOKIE, sessionCookieOptions } from "./auth.middleware.js";
import type { AuthService, Session } from "./auth.service.js";

/** /api/auth: sign up, sign in, sign out, who am I. The session lives in an httpOnly cookie. */
export function authRoutes(auth: AuthService) {
  const router = Router();

  const setCookie = (res: Response, session: Session) =>
    res.cookie(SESSION_COOKIE, session.token, { ...sessionCookieOptions, expires: session.expiresAt });

  router.get("/me", (req, res) => {
    res.json({ user: req.user ?? null });
  });

  router.post("/register", async (req, res) => {
    const session = await auth.register(parse(credentialsSchema, req.body));
    setCookie(res, session);
    res.status(201).json({ user: session.user });
  });

  router.post("/login", async (req, res) => {
    const session = await auth.login(parse(credentialsSchema, req.body));
    setCookie(res, session);
    res.json({ user: session.user });
  });

  router.post("/logout", async (req, res) => {
    await auth.logout(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions);
    res.status(204).end();
  });

  return router;
}
