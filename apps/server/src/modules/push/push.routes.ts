import { Router } from "express";
import { registerPushSchema, unregisterPushSchema } from "@pm/shared";
import { parse } from "../../shared/http.js";
import type { RequireAuth } from "../auth/index.js";
import type { PushService } from "./push.service.js";

/** /api/push: the Web Push key, and where the signed-in session's notifications go. */
export function pushRoutes(push: PushService, requireAuth: RequireAuth) {
  const router = Router();

  router.get("/config", (_req, res) => {
    res.json(push.config());
  });

  router.post("/subscriptions", requireAuth, async (req, res) => {
    await push.register(req.user!.id, req.sessionId!, parse(registerPushSchema, req.body));
    res.status(204).end();
  });

  router.delete("/subscriptions", requireAuth, async (req, res) => {
    await push.unregister(req.user!.id, parse(unregisterPushSchema, req.body).endpoint);
    res.status(204).end();
  });

  return router;
}
