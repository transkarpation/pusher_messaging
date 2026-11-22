import express from "express";
import cookieParser from "cookie-parser";
import type { Container } from "./container.js";
import { authRoutes, loadUser, requireAuth } from "./modules/auth/index.js";
import { blocksRoutes } from "./modules/blocks/index.js";
import { invitationsRoutes, roomsRoutes } from "./modules/chat/index.js";
import { docsRoutes } from "./modules/docs/docs.routes.js";
import { realtimeRoutes } from "./modules/realtime/index.js";
import { seedsRoutes } from "./modules/seeds/index.js";
import { profileRoutes, usersRoutes } from "./modules/users/index.js";
import { errorHandler } from "./shared/errors.js";

/** The HTTP app: parsers, the session user, each module's routes, docs and error handling. */
export function createApp(c: Container) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(loadUser(c.auth));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/auth", authRoutes(c.auth));
  app.use("/api/auth/me", profileRoutes(c.users, requireAuth));
  app.use("/api/rooms", roomsRoutes(c, requireAuth));
  app.use("/api/invites", invitationsRoutes(c.invites, requireAuth));
  app.use("/api/users", usersRoutes(c.users, requireAuth));
  app.use("/api/blocks", blocksRoutes(c.blocks, requireAuth));
  app.use("/api/realtime", realtimeRoutes(c.realtime, c.realtimeConfig, requireAuth));
  app.use("/api/seeds", seedsRoutes(c.seeds));
  app.use("/api", docsRoutes());

  app.use(errorHandler);
  return app;
}
