import { Router } from "express";
import type { RealtimeConfig } from "@pm/shared";
import { badRequest } from "../../shared/errors.js";
import type { RequireAuth } from "../auth/index.js";
import type { PusherGateway } from "./pusher.gateway.js";
import type { RealtimeService } from "./realtime.service.js";

/**
 * /api/realtime: which transport clients should use, and with the Pusher driver the
 * channel authorization endpoint for pusher-js. (The WebSocket endpoint itself is
 * attached to the HTTP server, not mounted here.)
 */
export function realtimeRoutes(
  realtime: RealtimeService,
  config: RealtimeConfig,
  pusher: PusherGateway | null,
  requireAuth: RequireAuth,
) {
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

  return router;
}
