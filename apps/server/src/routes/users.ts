import { Router } from "express";
import { and, asc, eq, ilike, ne, or } from "drizzle-orm";
import type { User } from "@pm/shared";
import { db, schema } from "../db/index.js";
import { userColumns } from "../lib/users.js";
import { requireAuth } from "../middleware/auth.js";

export const usersRouter = Router();
usersRouter.use(requireAuth);

/** GET /api/users?q=… — finds other users by username or name (for adding to rooms). */
usersRouter.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 64) : "";
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const users: User[] = await db
    .select(userColumns)
    .from(schema.users)
    .where(
      and(
        ne(schema.users.id, req.user!.id),
        q ? or(ilike(schema.users.username, pattern), ilike(schema.users.name, pattern)) : undefined,
      ),
    )
    .orderBy(asc(schema.users.username))
    .limit(20);

  res.json(users);
});

/**
 * GET /api/users/:id/avatar — the uploaded image. Clients use the versioned `User.avatarUrl`,
 * so the response can be cached for good.
 */
usersRouter.get("/:id/avatar", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [avatar] = await db
    .select({ contentType: schema.userAvatars.contentType, data: schema.userAvatars.data })
    .from(schema.userAvatars)
    .where(eq(schema.userAvatars.userId, id))
    .limit(1);
  if (!avatar) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res
    .set({
      "Content-Type": avatar.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    })
    .send(avatar.data);
});
