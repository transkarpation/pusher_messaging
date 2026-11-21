import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  ROOM_MEMBERS_EVENT,
  ROOM_REMOVED_EVENT,
  USER_TYPING_EVENT,
  addMembersSchema,
  createRoomSchema,
  roomChannel,
  typingSchema,
  userChannel,
  type RoomMembersEvent,
  type RoomRemovedEvent,
  type TypingEvent,
} from "@pm/shared";
import { db, schema } from "../db/index.js";
import { broadcast } from "../lib/pusher.js";
import { loadMembers, loadRooms, notifyAdded } from "../lib/rooms.js";
import { parseBody } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { requireRoomMember } from "../middleware/room.js";
import { messagesRouter } from "./messages.js";

export const roomsRouter = Router();
roomsRouter.use(requireAuth);

/** Keeps only ids of existing users, deduplicated, without `exclude`. */
async function existingUserIds(ids: number[], exclude: number): Promise<number[]> {
  const unique = [...new Set(ids)].filter((id) => id !== exclude);
  if (unique.length === 0) return [];
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(inArray(schema.users.id, unique));
  return rows.map((r) => r.id);
}

roomsRouter.get("/", async (req, res) => {
  res.json(await loadRooms(req.user!.id));
});

roomsRouter.post("/", async (req, res) => {
  const input = parseBody(createRoomSchema, req.body, res);
  if (!input) return;
  const me = req.user!;
  const memberIds = await existingUserIds(input.memberIds, me.id);

  const roomId = await db.transaction(async (tx) => {
    const [room] = await tx
      .insert(schema.rooms)
      .values({ name: input.name, createdBy: me.id })
      .returning({ id: schema.rooms.id });
    await tx.insert(schema.roomMembers).values([
      { roomId: room!.id, userId: me.id, role: "owner" as const },
      ...memberIds.map((userId) => ({ roomId: room!.id, userId, role: "member" as const })),
    ]);
    return room!.id;
  });

  const [room] = await loadRooms(me.id, [roomId]);
  res.status(201).json(room);
  void notifyAdded(roomId, memberIds);
});

// Everything below acts on a specific room the caller belongs to.
roomsRouter.use("/:roomId", requireRoomMember);
roomsRouter.use("/:roomId", messagesRouter);

roomsRouter.get("/:roomId", async (req, res) => {
  const [room] = await loadRooms(req.user!.id, [req.room!.id]);
  res.json(room);
});

const broadcastMembers = async (roomId: number, req: Parameters<typeof broadcast>[3]) => {
  const members = await loadMembers(roomId);
  const event: RoomMembersEvent = { roomId, members };
  broadcast(roomChannel(roomId), ROOM_MEMBERS_EVENT, event, req);
  return members;
};

/** Any member may add people. */
roomsRouter.post("/:roomId/members", async (req, res) => {
  const input = parseBody(addMembersSchema, req.body, res);
  if (!input) return;
  const roomId = req.room!.id;
  const candidates = await existingUserIds(input.userIds, req.user!.id);

  const added =
    candidates.length === 0
      ? []
      : await db
          .insert(schema.roomMembers)
          .values(candidates.map((userId) => ({ roomId, userId })))
          .onConflictDoNothing()
          .returning({ userId: schema.roomMembers.userId });

  const members = added.length > 0 ? await broadcastMembers(roomId, req) : await loadMembers(roomId);
  res.json({ members });
  void notifyAdded(
    roomId,
    added.map((a) => a.userId),
  );
});

/** The owner may remove anyone else; any non-owner may remove themselves (leave). */
roomsRouter.delete("/:roomId/members/:userId", async (req, res) => {
  const roomId = req.room!.id;
  const targetId = Number(req.params.userId);
  const self = targetId === req.user!.id;

  if (self && req.room!.role === "owner") {
    res.status(400).json({ error: "The owner can't leave the room" });
    return;
  }
  if (!self && req.room!.role !== "owner") {
    res.status(403).json({ error: "Only the owner can remove members" });
    return;
  }

  const [removed] = await db
    .delete(schema.roomMembers)
    .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, targetId)))
    .returning({ userId: schema.roomMembers.userId });
  if (!removed) {
    res.status(404).json({ error: "Not a member" });
    return;
  }

  const members = await broadcastMembers(roomId, req);
  res.json({ members });
  const event: RoomRemovedEvent = { roomId };
  broadcast(userChannel(targetId), ROOM_REMOVED_EVENT, event);
});

/** Relays the caller's typing state to the other members. */
roomsRouter.post("/:roomId/typing", (req, res) => {
  const input = parseBody(typingSchema, req.body, res);
  if (!input) return;
  const roomId = req.room!.id;
  const event: TypingEvent = { roomId, userId: req.user!.id, typing: input.typing };
  broadcast(roomChannel(roomId), USER_TYPING_EVENT, event, req);
  res.status(204).end();
});
