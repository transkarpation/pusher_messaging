import { Router } from "express";
import { blockSchema, type BlocksEvent } from "@pm/shared";
import { actorOf, idParam, parse } from "../../shared/http.js";
import type { RequireAuth } from "../auth/index.js";
import type { BlocksService } from "./blocks.service.js";

/** /api/blocks: the signed-in user's block list. */
export function blocksRoutes(blocks: BlocksService, requireAuth: RequireAuth) {
  const router = Router();
  router.use(requireAuth);

  router.get("/", async (req, res) => {
    const body: BlocksEvent = { blocked: await blocks.list(req.user!.id) };
    res.json(body);
  });

  router.post("/", async (req, res) => {
    const { userId } = parse(blockSchema, req.body);
    const body: BlocksEvent = { blocked: await blocks.block(actorOf(req), userId) };
    res.json(body);
  });

  router.delete("/:userId", async (req, res) => {
    const userId = idParam(req.params.userId, "Invalid user id");
    const body: BlocksEvent = { blocked: await blocks.unblock(actorOf(req), userId) };
    res.json(body);
  });

  return router;
}
