import { Router, type RequestHandler } from "express";
import {
  createMessageSchema,
  createRoomSchema,
  inviteSchema,
  messagesQuerySchema,
  typingSchema,
  updateMessageSchema,
  updateReceiptSchema,
} from "@pm/shared";
import { notFound } from "../../shared/errors.js";
import { actorOf, idParam, parse } from "../../shared/http.js";
import type { RequireAuth } from "../auth/index.js";
import type { InvitesService } from "./invites.service.js";
import type { MessagesService } from "./messages.service.js";
import type { RoomAccess, RoomsService } from "./rooms.service.js";

declare global {
  namespace Express {
    interface Request {
      room?: RoomAccess;
    }
  }
}

/** Requires `:roomId` to be a room the current user belongs to; sets `req.room`. */
const requireRoomMember =
  (rooms: RoomsService): RequestHandler<{ roomId: string }> =>
  async (req, _res, next) => {
    const roomId = idParam(req.params.roomId, "Invalid room id");
    const role = await rooms.membership(roomId, req.user!.id);
    // Same answer for "doesn't exist" and "not a member" to avoid leaking room ids.
    if (!role) throw notFound("Room not found");
    req.room = { id: roomId, role };
    next();
  };

/** /api/rooms: rooms, members, invites to a room, typing, messages and receipts. */
export function roomsRoutes(
  services: { rooms: RoomsService; invites: InvitesService; messages: MessagesService },
  requireAuth: RequireAuth,
) {
  const { rooms, invites, messages } = services;
  const router = Router();
  router.use(requireAuth);

  router.get("/", async (req, res) => {
    res.json(await rooms.listFor(req.user!.id));
  });

  router.post("/", async (req, res) => {
    const input = parse(createRoomSchema, req.body);
    res.status(201).json(await rooms.create(actorOf(req), input));
  });

  // Everything below acts on a specific room the caller belongs to.
  const room = Router({ mergeParams: true });
  router.use("/:roomId", requireRoomMember(rooms), room);

  room.get("/", async (req, res) => {
    res.json(await rooms.get(req.user!.id, req.room!.id));
  });

  /** Any member may invite people; they join once they accept (see /api/invites). */
  room.post("/invites", async (req, res) => {
    const { userIds } = parse(inviteSchema, req.body);
    res.json({ invites: await invites.invite(actorOf(req), req.room!.id, userIds) });
  });

  room.delete("/invites/:userId", async (req, res) => {
    const userId = idParam(req.params.userId, "Invalid user id");
    res.json({ invites: await invites.cancel(actorOf(req), req.room!, userId) });
  });

  room.delete("/members/:userId", async (req, res) => {
    const userId = idParam(req.params.userId, "Invalid user id");
    res.json({ members: await rooms.removeMember(actorOf(req), req.room!, userId) });
  });

  room.post("/typing", (req, res) => {
    const { typing } = parse(typingSchema, req.body);
    rooms.typing(actorOf(req), req.room!.id, typing);
    res.status(204).end();
  });

  room.get("/messages", async (req, res) => {
    const cursor = parse(messagesQuerySchema, req.query);
    res.json(await messages.page(req.room!.id, cursor));
  });

  room.post("/messages", async (req, res) => {
    const { text } = parse(createMessageSchema, req.body);
    res.status(201).json(await messages.send(actorOf(req), req.room!.id, text));
  });

  room.patch("/messages/:messageId", async (req, res) => {
    const messageId = idParam(req.params.messageId, "Invalid message id");
    const { text } = parse(updateMessageSchema, req.body);
    res.json(await messages.edit(actorOf(req), req.room!.id, messageId, text));
  });

  room.delete("/messages/:messageId", async (req, res) => {
    const messageId = idParam(req.params.messageId, "Invalid message id");
    res.json(await messages.remove(actorOf(req), req.room!, messageId));
  });

  room.post("/receipts", async (req, res) => {
    const input = parse(updateReceiptSchema, req.body);
    res.json(await messages.advanceReceipt(actorOf(req), req.room!.id, input));
  });

  return router;
}

/** /api/invites: the signed-in user's own invitations. */
export function invitationsRoutes(invites: InvitesService, requireAuth: RequireAuth) {
  const router = Router();
  router.use(requireAuth);

  router.get("/", async (req, res) => {
    res.json(await invites.listFor(req.user!.id));
  });

  router.post("/:roomId/accept", async (req, res) => {
    const roomId = idParam(req.params.roomId, "Invalid room id");
    res.json(await invites.accept(actorOf(req), roomId));
  });

  router.post("/:roomId/decline", async (req, res) => {
    const roomId = idParam(req.params.roomId, "Invalid room id");
    await invites.decline(actorOf(req), roomId);
    res.status(204).end();
  });

  return router;
}
