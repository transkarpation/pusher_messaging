import express, { Router, type RequestHandler } from "express";
import {
  ATTACHMENT_MAX_BYTES,
  AUDIO_DURATION_HEADER,
  AUDIO_WAVEFORM_HEADER,
  FILE_NAME_HEADER,
  FILE_TYPE_HEADER,
  createMessageSchema,
  createPollSchema,
  createRoomSchema,
  inviteSchema,
  messagesQuerySchema,
  pollCommentSchema,
  pollOptionSchema,
  pollVoteSchema,
  typingSchema,
  updateMessageSchema,
  updateReceiptSchema,
} from "@pm/shared";
import { notFound } from "../../shared/errors.js";
import { actorOf, idParam, parse } from "../../shared/http.js";
import type { RequireAuth } from "../auth/index.js";
import type { AttachmentsService } from "./attachments.service.js";
import type { InvitesService } from "./invites.service.js";
import type { MessagesService } from "./messages.service.js";
import type { PollsService } from "./polls.service.js";
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
  services: {
    rooms: RoomsService;
    invites: InvitesService;
    messages: MessagesService;
    attachments: AttachmentsService;
    polls: PollsService;
  },
  requireAuth: RequireAuth,
) {
  const { rooms, invites, messages, attachments, polls } = services;
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
    res.json(await messages.page(req.user!.id, req.room!.id, cursor));
  });

  room.post("/messages", async (req, res) => {
    const { text, attachmentIds } = parse(createMessageSchema, req.body);
    res.status(201).json(await messages.send(actorOf(req), req.room!.id, text, attachmentIds));
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

  /** Only the room owner may post a poll; it arrives as a message of kind "poll". */
  room.post("/polls", async (req, res) => {
    const input = parse(createPollSchema, req.body);
    res.status(201).json(await polls.create(actorOf(req), req.room!, input));
  });

  /** Replaces the caller's vote; `optionIds: []` takes it back. */
  room.put("/polls/:messageId/votes", async (req, res) => {
    const messageId = idParam(req.params.messageId, "Invalid poll id");
    const { optionIds } = parse(pollVoteSchema, req.body);
    res.json(await polls.vote(actorOf(req), req.room!.id, messageId, optionIds));
  });

  room.post("/polls/:messageId/options", async (req, res) => {
    const messageId = idParam(req.params.messageId, "Invalid poll id");
    const { text } = parse(pollOptionSchema, req.body);
    res.status(201).json(await polls.addOption(actorOf(req), req.room!.id, messageId, text));
  });

  room.post("/polls/:messageId/comments", async (req, res) => {
    const messageId = idParam(req.params.messageId, "Invalid poll id");
    const { text } = parse(pollCommentSchema, req.body);
    res.status(201).json(await polls.comment(actorOf(req), req.room!.id, messageId, text));
  });

  room.post("/receipts", async (req, res) => {
    const input = parse(updateReceiptSchema, req.body);
    res.json(await messages.advanceReceipt(actorOf(req), req.room!.id, input));
  });

  /**
   * Uploads one file as the raw application/octet-stream body, its type in X-File-Type and
   * its name URI-encoded in X-File-Name; for recorded audio optionally X-Audio-Duration and
   * X-Audio-Waveform. The returned id then goes in `attachmentIds` of POST /messages.
   */
  room.post(
    "/attachments",
    express.raw({ type: "application/octet-stream", limit: ATTACHMENT_MAX_BYTES }),
    async (req, res) => {
      const file = {
        data: req.body,
        name: req.get(FILE_NAME_HEADER),
        contentType: req.get(FILE_TYPE_HEADER),
        durationMs: req.get(AUDIO_DURATION_HEADER),
        waveform: req.get(AUDIO_WAVEFORM_HEADER),
      };
      res.status(201).json(await attachments.upload(actorOf(req), req.room!.id, file));
    },
  );

  /**
   * Pictures and audio are served with their type; anything else is always downloaded, never
   * rendered by the browser. Supports a single byte range, which Safari needs to play audio.
   */
  room.get("/attachments/:attachmentId", async (req, res) => {
    const id = idParam(req.params.attachmentId, "Invalid attachment id");
    const file = await attachments.download(req.user!.id, req.room!.id, id);
    const disposition = `${file.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeRFC5987(file.name)}`;
    res.set({
      "Content-Type": file.inline ? file.contentType : "application/octet-stream",
      "Content-Disposition": disposition,
      "Cache-Control": "private, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    const range = parseRange(req.get("Range"), file.data.length);
    if (range === "invalid") {
      res.status(416).set("Content-Range", `bytes */${file.data.length}`).end();
      return;
    }
    if (range) {
      res
        .status(206)
        .set("Content-Range", `bytes ${range.start}-${range.end}/${file.data.length}`)
        .send(file.data.subarray(range.start, range.end + 1));
      return;
    }
    res.send(file.data);
  });

  return router;
}

/**
 * A single `bytes=start-end` / `bytes=start-` / `bytes=-suffix` range within `size` bytes:
 * null when there's no (usable) Range header, "invalid" when it can't be satisfied.
 * Multiple ranges aren't supported; the whole file is sent instead.
 */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | "invalid" | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start > end || start >= size ? "invalid" : { start, end };
}

/** A file name for `filename*=UTF-8''…` in Content-Disposition. */
const encodeRFC5987 = (name: string) =>
  encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

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
