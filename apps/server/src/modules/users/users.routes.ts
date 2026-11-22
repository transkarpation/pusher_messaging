import express, { Router } from "express";
import { AVATAR_CONTENT_TYPES, AVATAR_MAX_BYTES, updateProfileSchema } from "@pm/shared";
import { notFound } from "../../shared/errors.js";
import { parse } from "../../shared/http.js";
import type { RequireAuth } from "../auth/auth.middleware.js";
import type { UsersService } from "./users.service.js";

/** The signed-in user's own profile, mounted under /api/auth/me. */
export function profileRoutes(users: UsersService, requireAuth: RequireAuth) {
  const router = Router();
  router.use(requireAuth);

  router.patch("/", async (req, res) => {
    const input = parse(updateProfileSchema, req.body);
    res.json({ user: await users.updateName(req.user!.id, input.name) });
  });

  /** The image is the raw body (PNG, JPEG or WebP). */
  router.put("/avatar", express.raw({ type: [...AVATAR_CONTENT_TYPES], limit: AVATAR_MAX_BYTES }), async (req, res) => {
    res.json({ user: await users.setAvatar(req.user!.id, req.body) });
  });

  router.delete("/avatar", async (req, res) => {
    res.json({ user: await users.removeAvatar(req.user!.id) });
  });

  return router;
}

/** /api/users: finding people, and avatar images. */
export function usersRoutes(users: UsersService, requireAuth: RequireAuth) {
  const router = Router();
  router.use(requireAuth);

  /** GET /api/users?q=… — other users by username or name (for inviting to rooms). */
  router.get("/", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 64) : "";
    res.json(await users.search(q, req.user!));
  });

  /** Clients use the versioned `User.avatarUrl`, so the response can be cached for good. */
  router.get("/:id/avatar", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw notFound("Not found");
    const avatar = await users.getAvatar(id);
    res
      .set({
        "Content-Type": avatar.contentType,
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      })
      .send(avatar.data);
  });

  return router;
}
