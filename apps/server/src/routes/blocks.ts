import { Router, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { BLOCKS_UPDATED_EVENT, blockSchema, userChannel, type BlocksEvent, type User } from "@pm/shared";
import { db, schema } from "../db/index.js";
import { broadcast } from "../lib/pusher.js";
import { userColumns } from "../lib/users.js";
import { parseBody } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";

const { users, userBlocks } = schema;

export const blocksRouter = Router();
blocksRouter.use(requireAuth);

/** Users the given user blocked, most recently blocked first. */
async function loadBlocked(userId: number): Promise<User[]> {
  return db
    .select(userColumns)
    .from(userBlocks)
    .innerJoin(users, eq(users.id, userBlocks.blockedId))
    .where(eq(userBlocks.blockerId, userId))
    .orderBy(desc(userBlocks.createdAt));
}

/** Responds with the new list and tells the user's other tabs about it. */
async function respond(req: Request, res: Response) {
  const blocked = await loadBlocked(req.user!.id);
  const event: BlocksEvent = { blocked };
  res.json(event);
  broadcast(userChannel(req.user!.id), BLOCKS_UPDATED_EVENT, event, req);
}

/** GET /api/blocks — people the current user blocked. */
blocksRouter.get("/", async (req, res) => {
  const event: BlocksEvent = { blocked: await loadBlocked(req.user!.id) };
  res.json(event);
});

/** POST /api/blocks { userId } — hides that user's messages from the current user everywhere. */
blocksRouter.post("/", async (req, res) => {
  const input = parseBody(blockSchema, req.body, res);
  if (!input) return;
  const me = req.user!;
  if (input.userId === me.id) {
    res.status(400).json({ error: "You can't block yourself" });
    return;
  }
  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await db.insert(userBlocks).values({ blockerId: me.id, blockedId: target.id }).onConflictDoNothing();
  await respond(req, res);
});

/** DELETE /api/blocks/:userId — unblocks. */
blocksRouter.delete("/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  await db
    .delete(userBlocks)
    .where(and(eq(userBlocks.blockerId, req.user!.id), eq(userBlocks.blockedId, userId)));
  await respond(req, res);
});
