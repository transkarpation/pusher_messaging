import express from "express";
import cookieParser from "cookie-parser";
import type { Container } from "./container.js";
import { adminRoutes } from "./modules/admin/index.js";
import { authRoutes, loadUser, requireAdmin, requireAuth } from "./modules/auth/index.js";
import { blocksRoutes } from "./modules/blocks/index.js";
import { invitationsRoutes, roomsRoutes } from "./modules/chat/index.js";
import { docsRoutes } from "./modules/docs/docs.routes.js";
import { pushRoutes } from "./modules/push/index.js";
import { realtimeRoutes } from "./modules/realtime/index.js";
import { seedsRoutes } from "./modules/seeds/index.js";
import { profileRoutes, usersRoutes } from "./modules/users/index.js";
import { applyRateLimits } from "./rateLimits.js";
import { errorHandler } from "./shared/errors.js";

/** The HTTP app: parsers, the session user, rate limits, each module's routes, docs and error handling. */
export function createApp(c: Container) {
  const app = express();
  // Behind a reverse proxy, client IPs (for rate limits) come from X-Forwarded-For: TRUST_PROXY
  // is the number of proxies in front, or a value Express's "trust proxy" setting takes.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) app.set("trust proxy", /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  // Room creation carries its picture base64-encoded (up to AVATAR_MAX_BYTES), hence the limit.
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(loadUser(c.auth));
  applyRateLimits(app, c.redis);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/auth", authRoutes(c.auth));
  app.use("/api/auth/me", profileRoutes(c.users, requireAuth));
  app.use("/api/rooms", roomsRoutes(c, requireAuth));
  app.use("/api/invites", invitationsRoutes(c.invites, requireAuth));
  app.use("/api/users", usersRoutes(c.users, requireAuth));
  app.use("/api/admin", adminRoutes(c.admin, requireAdmin));
  app.use("/api/blocks", blocksRoutes(c.blocks, requireAuth));
  app.use("/api/realtime", realtimeRoutes(c.realtime, c.phoenix, requireAuth));
  app.use("/api/push", pushRoutes(c.push, requireAuth));
  app.use("/api/seeds", seedsRoutes(c.seeds));
  app.use("/api", docsRoutes());

  app.use(errorHandler);
  return app;
}
