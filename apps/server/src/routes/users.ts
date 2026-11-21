import { Router } from "express";
import { and, asc, ilike, ne, or } from "drizzle-orm";
import type { User } from "@pm/shared";
import { db, schema } from "../db/index.js";
import { userColumns } from "../lib/rooms.js";
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
