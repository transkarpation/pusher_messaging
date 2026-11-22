import { Router } from "express";
import type { RealtimeConfig } from "@pm/shared";
import { badRequest } from "../../shared/errors.js";
import type { RequireAuth } from "../auth/index.js";
import type { RealtimeService } from "./realtime.service.js";

/** /api/realtime: the public Pusher config, and channel authorization for pusher-js. */
export function realtimeRoutes(realtime: RealtimeService, config: RealtimeConfig, requireAuth: RequireAuth) {
  const router = Router();

  router.get("/config", (_req, res) => {
    res.json(config);
  });

  /** pusher-js posts socket_id + channel_name (form-encoded). */
  router.post("/pusher/auth", requireAuth, async (req, res) => {
    const { socket_id: socketId, channel_name: channel } = req.body ?? {};
    if (typeof socketId !== "string" || typeof channel !== "string") {
      throw badRequest("socket_id and channel_name are required");
    }
    res.json(await realtime.authorize(req.user!, socketId, channel));
  });

  return router;
}
