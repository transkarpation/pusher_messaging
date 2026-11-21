import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  MESSAGE_CREATED_EVENT,
  ROOM_MEMBERS_EVENT,
  roomChannel,
  type Message,
  type RoomMembersEvent,
} from "@pm/shared";
import { db, schema } from "../db/index.js";
import { broadcastRoomInvites, loadInvitations, notifyInvitationRemoved } from "../lib/invites.js";
import { broadcast } from "../lib/pusher.js";
import { loadRooms, notifyAdded } from "../lib/rooms.js";
import { requireAuth } from "../middleware/auth.js";

/** The current user's own invitations: list, accept, decline. */
export const invitesRouter = Router();
invitesRouter.use(requireAuth);

invitesRouter.get("/", async (req, res) => {
  res.json(await loadInvitations(req.user!.id));
});

/** Parses `:roomId`; on failure sends 400 and returns null. */
function roomIdParam(req: Request, res: Response) {
  const id = Number(req.params.roomId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid room id" });
    return null;
  }
  return id;
}

const deleteInvite = (tx: Pick<typeof db, "delete">, roomId: number, userId: number) =>
  tx
    .delete(schema.roomInvites)
    .where(and(eq(schema.roomInvites.roomId, roomId), eq(schema.roomInvites.userId, userId)))
    .returning({ userId: schema.roomInvites.userId });

/**
 * Joins the room and posts a "joined the room" system message.
 * Responds with the `Room`, like creating one does.
 */
invitesRouter.post("/:roomId/accept", async (req, res) => {
  const roomId = roomIdParam(req, res);
  if (!roomId) return;
  const me = req.user!;

  const joined = await db.transaction(async (tx) => {
    const [invite] = await deleteInvite(tx, roomId, me.id);
    if (!invite) return null;
    const [member] = await tx
      .insert(schema.roomMembers)
      .values({ roomId, userId: me.id })
      .onConflictDoNothing()
      .returning({ userId: schema.roomMembers.userId });
    if (!member) return { message: null }; // already a member somehow: nothing to announce
    const [row] = await tx
      .insert(schema.messages)
      .values({ roomId, userId: me.id, kind: "member_joined", text: "" })
      .returning();
    const message: Message = {
      id: row!.id,
      roomId,
      kind: "member_joined",
      text: "",
      createdAt: row!.createdAt.toISOString(),
      editedAt: null,
      deletedAt: null,
      author: me,
    };
    return { message };
  });
  if (!joined) {
    res.status(404).json({ error: "Invitation not found" });
    return;
  }

  // Loaded after the insert, so the join message is already the room's last message.
  const [room] = await loadRooms(me.id, [roomId]);
  res.json(room);

  const event: RoomMembersEvent = { roomId, members: room!.members };
  broadcast(roomChannel(roomId), ROOM_MEMBERS_EVENT, event);
  if (joined.message) broadcast(roomChannel(roomId), MESSAGE_CREATED_EVENT, joined.message);
  void broadcastRoomInvites(roomId).catch((err) => console.error("broadcastRoomInvites failed:", err));
  // My other tabs: the invitation is gone and the room appears.
  notifyInvitationRemoved(me.id, roomId, req);
  void notifyAdded(roomId, [me.id]);
});

invitesRouter.post("/:roomId/decline", async (req, res) => {
  const roomId = roomIdParam(req, res);
  if (!roomId) return;
  const me = req.user!;

  const [invite] = await deleteInvite(db, roomId, me.id);
  if (!invite) {
    res.status(404).json({ error: "Invitation not found" });
    return;
  }
  res.status(204).end();
  void broadcastRoomInvites(roomId).catch((err) => console.error("broadcastRoomInvites failed:", err));
  notifyInvitationRemoved(me.id, roomId, req);
});
