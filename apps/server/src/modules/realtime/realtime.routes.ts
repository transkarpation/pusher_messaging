import { Router } from "express";
import type { RealtimeConfig } from "@pm/shared";
import { badRequest, unauthorized } from "../../shared/errors.js";
import type { RequireAuth } from "../auth/index.js";
import type { PhoenixGateway } from "./phoenix.gateway.js";
import type { PusherGateway } from "./pusher.gateway.js";
import type { RealtimeService } from "./realtime.service.js";

/**
 * /api/realtime: which transport clients should use, plus what the active one needs:
 * channel signatures for pusher-js, or connection tokens and the authorization callback
 * for the Phoenix server. (The own WebSocket endpoint is attached to the HTTP server.)
 */
export function realtimeRoutes(
  realtime: RealtimeService,
  config: RealtimeConfig,
  gateways: { pusher: PusherGateway | null; phoenix: PhoenixGateway | null },
  requireAuth: RequireAuth,
) {
  const { pusher, phoenix } = gateways;
  const router = Router();

  router.get("/config", (_req, res) => {
    res.json(config);
  });

  if (pusher) {
    /** pusher-js posts socket_id + channel_name (form-encoded). */
    router.post("/pusher/auth", requireAuth, async (req, res) => {
      const { socket_id: socketId, channel_name: channel } = req.body ?? {};
      if (typeof socketId !== "string" || typeof channel !== "string") {
        throw badRequest("socket_id and channel_name are required");
      }
      const grant = await realtime.authorize(req.user!, channel);
      res.json(pusher.sign(socketId, channel, grant));
    });
  }

  if (phoenix) {
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
  }

  return router;
}
