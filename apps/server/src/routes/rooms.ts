import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  ROOM_MEMBERS_EVENT,
  ROOM_REMOVED_EVENT,
  USER_TYPING_EVENT,
  createRoomSchema,
  inviteSchema,
  roomChannel,
  typingSchema,
  userChannel,
  type RoomMembersEvent,
  type RoomRemovedEvent,
  type TypingEvent,
} from "@pm/shared";
import { db, schema } from "../db/index.js";
import { broadcast } from "../lib/pusher.js";
import {
  broadcastRoomInvites,
  createInvites,
  notifyInvitationRemoved,
  notifyInvited,
} from "../lib/invites.js";
import { loadMembers, loadRooms } from "../lib/rooms.js";
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
  const inviteIds = await existingUserIds(input.inviteIds, me.id);

  const roomId = await db.transaction(async (tx) => {
    const [room] = await tx
      .insert(schema.rooms)
      .values({ name: input.name, createdBy: me.id })
      .returning({ id: schema.rooms.id });
    await tx.insert(schema.roomMembers).values({ roomId: room!.id, userId: me.id, role: "owner" });
    if (inviteIds.length > 0) {
      await tx
        .insert(schema.roomInvites)
        .values(inviteIds.map((userId) => ({ roomId: room!.id, userId, invitedBy: me.id })));
    }
    return room!.id;
  });

  const [room] = await loadRooms(me.id, [roomId]);
  res.status(201).json(room);
  void notifyInvited(roomId, inviteIds);
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

/** Any member may invite people; they join once they accept (see routes/invites.ts). */
roomsRouter.post("/:roomId/invites", async (req, res) => {
  const input = parseBody(inviteSchema, req.body, res);
  if (!input) return;
  const roomId = req.room!.id;
  const candidates = await existingUserIds(input.userIds, req.user!.id);
  const invited = await createInvites(roomId, req.user!.id, candidates);

  const invites = await broadcastRoomInvites(roomId, req);
  res.json({ invites });
  void notifyInvited(roomId, invited);
});

/** The owner, or whoever sent the invite, may cancel it. */
roomsRouter.delete("/:roomId/invites/:userId", async (req, res) => {
  const roomId = req.room!.id;
  const targetId = Number(req.params.userId);
  const { roomInvites } = schema;

  const [removed] = await db
    .delete(roomInvites)
    .where(
      and(
        eq(roomInvites.roomId, roomId),
        eq(roomInvites.userId, targetId),
        req.room!.role === "owner" ? undefined : eq(roomInvites.invitedBy, req.user!.id),
      ),
    )
    .returning({ userId: roomInvites.userId });
  if (!removed) {
    const [exists] = await db
      .select({ userId: roomInvites.userId })
      .from(roomInvites)
      .where(and(eq(roomInvites.roomId, roomId), eq(roomInvites.userId, targetId)))
      .limit(1);
    if (exists) res.status(403).json({ error: "Only the owner or the inviter can cancel an invite" });
    else res.status(404).json({ error: "Invite not found" });
    return;
  }

  const invites = await broadcastRoomInvites(roomId, req);
  res.json({ invites });
  notifyInvitationRemoved(targetId, roomId);
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
