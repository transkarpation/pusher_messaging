import { Router } from "express";
import { eq } from "drizzle-orm";
import {
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
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

const toUser = (u: typeof schema.users.$inferSelect): User => ({
  id: u.id,
  username: u.username,
  name: u.name,
});

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
    .returning();

  if (!user) {
    res.status(409).json({ error: "Username is already taken" });
    return;
  }

  await createSession(res, user.id);
  res.status(201).json({ user: toUser(user) });
});

authRouter.post("/login", async (req, res) => {
  const input = parseBody(credentialsSchema, req.body, res);
  if (!input) return;

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, input.username.toLowerCase()))
    .limit(1);

  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  await createSession(res, user.id);
  res.json({ user: toUser(user) });
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
    .returning();

  const updated = toUser(user!);
  res.json({ user: updated });

  // Presence user_info is fixed at subscribe time, so tell everyone about the new name.
  broadcast(ONLINE_CHANNEL, USER_UPDATED_EVENT, updated);
});
