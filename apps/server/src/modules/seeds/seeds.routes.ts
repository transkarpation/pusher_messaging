import { Router } from "express";
import type { SeedsResponse } from "@pm/shared";
import { notFound } from "../../shared/errors.js";
import type { SeedsService } from "./seeds.service.js";

/** /api/seeds: public (no login) list of the demo accounts with their password. */
export function seedsRoutes(seeds: SeedsService) {
  const router = Router();

  router.get("/", async (_req, res) => {
    if (!seeds.enabled) throw notFound("Not found");
    const body: SeedsResponse = { accounts: await seeds.accounts() };
    res.json(body);
  });

  return router;
}
