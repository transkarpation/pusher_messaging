import express, { Router } from "express";
import { eq } from "drizzle-orm";
import {
  AVATAR_CONTENT_TYPES,
  AVATAR_MAX_BYTES,
  ONLINE_CHANNEL,
  USER_UPDATED_EVENT,
  credentialsSchema,
  updateProfileSchema,
  type User,
} from "@pm/shared";
import { db, schema } from "../db/index.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { SESSION_COOKIE, createSession, destroySession } from "../lib/session.js";
import { parseBody } from "../lib/validate.js";
import { broadcast } from "../lib/pusher.js";
import { sniffImageType, userColumns } from "../lib/users.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

/** Presence user_info is fixed at subscribe time, so profile changes are broadcast to everyone. */
const announce = (user: User) => broadcast(ONLINE_CHANNEL, USER_UPDATED_EVENT, user);

authRouter.get("/me", (req, res) => {
  res.json({ user: req.user ?? null });
});

authRouter.post("/register", async (req, res) => {
  const input = parseBody(credentialsSchema, req.body, res);
  if (!input) return;

  const username = input.username.toLowerCase();
  const passwordHash = await hashPassword(input.password);
  const [user] = await db
    .insert(schema.users)
    .values({ username, passwordHash })
    .onConflictDoNothing({ target: schema.users.username })
    .returning(userColumns);

  if (!user) {
    res.status(409).json({ error: "Username is already taken" });
    return;
  }

  await createSession(res, user.id);
  res.status(201).json({ user });
});

authRouter.post("/login", async (req, res) => {
  const input = parseBody(credentialsSchema, req.body, res);
  if (!input) return;

  const [row] = await db
    .select({ ...userColumns, passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.username, input.username.toLowerCase()))
    .limit(1);

  if (!row || !(await verifyPassword(input.password, row.passwordHash))) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const { passwordHash: _, ...user } = row;
  await createSession(res, user.id);
  res.json({ user });
});

authRouter.post("/logout", async (req, res) => {
  await destroySession(res, req.cookies?.[SESSION_COOKIE]);
  res.status(204).end();
});

authRouter.patch("/me", requireAuth, async (req, res) => {
  const input = parseBody(updateProfileSchema, req.body, res);
  if (!input) return;

  const [user] = await db
    .update(schema.users)
    .set({ name: input.name })
    .where(eq(schema.users.id, req.user!.id))
    .returning(userColumns);

  res.json({ user });
  announce(user!);
});

/** PUT /api/auth/me/avatar — the image is the raw body (PNG, JPEG or WebP). */
authRouter.put(
  "/me/avatar",
  requireAuth,
  express.raw({ type: [...AVATAR_CONTENT_TYPES], limit: AVATAR_MAX_BYTES }),
  async (req, res) => {
    const data: unknown = req.body;
    // Trust the bytes, not the Content-Type header: the type is served back to browsers.
    const contentType = Buffer.isBuffer(data) ? sniffImageType(data) : null;
    if (!contentType) {
      res.status(400).json({ error: "Upload a PNG, JPEG or WebP image" });
      return;
    }
    const userId = req.user!.id;

    const user = await db.transaction(async (tx) => {
      await tx
        .insert(schema.userAvatars)
        .values({ userId, contentType, data: data as Buffer })
        .onConflictDoUpdate({ target: schema.userAvatars.userId, set: { contentType, data: data as Buffer } });
      const [u] = await tx
        .update(schema.users)
        .set({ avatarUpdatedAt: new Date() })
        .where(eq(schema.users.id, userId))
        .returning(userColumns);
      return u!;
    });

    res.json({ user });
    announce(user);
  },
);

authRouter.delete("/me/avatar", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const user = await db.transaction(async (tx) => {
    await tx.delete(schema.userAvatars).where(eq(schema.userAvatars.userId, userId));
    const [u] = await tx
      .update(schema.users)
      .set({ avatarUpdatedAt: null })
      .where(eq(schema.users.id, userId))
      .returning(userColumns);
    return u!;
  });

  res.json({ user });
  announce(user);
});
