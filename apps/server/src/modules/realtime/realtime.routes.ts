import { Router } from "express";
import type { RealtimeConfig } from "@pm/shared";
import { unauthorized } from "../../shared/errors.js";
import type { RequireAuth } from "../auth/index.js";
import type { PhoenixGateway } from "./phoenix.gateway.js";
import type { RealtimeService } from "./realtime.service.js";

/**
 * /api/realtime: where clients connect (the Phoenix server), the tokens they connect with,
 * the authorization callback the Phoenix server calls on every channel join, and its reports
 * of who was last connected when.
 */
export function realtimeRoutes(realtime: RealtimeService, phoenix: PhoenixGateway, requireAuth: RequireAuth) {
  const router = Router();
  const config: RealtimeConfig = { socketUrl: phoenix.config.socketUrl };

  router.get("/config", (_req, res) => {
    res.json(config);
  });

  /** A token to connect to the Phoenix server with, for the signed-in user. */
  router.get("/phoenix/token", requireAuth, (req, res) => {
    const { token, expiresAt } = phoenix.issueToken(req.user!.id);
    res.json({ token, expiresAt: expiresAt.toISOString() });
  });

  /** The Phoenix server asks whether `userId` may join `channel`; answers with the grant or 403. */
  router.post("/phoenix/authorize", async (req, res) => {
    if (!phoenix.isPhoenix(req.get("Authorization"))) throw unauthorized("Invalid shared secret");
    res.json(await realtime.authorizeUserId(req.body?.userId, req.body?.channel));
  });

  /** The Phoenix server reports who is connected and who just left (for `lastSeenAt`). */
  router.post("/phoenix/seen", async (req, res) => {
    if (!phoenix.isPhoenix(req.get("Authorization"))) throw unauthorized("Invalid shared secret");
    await realtime.recordSeen(req.body);
    res.status(204).end();
  });

  return router;
}
