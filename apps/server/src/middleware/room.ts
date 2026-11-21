import type { RequestHandler } from "express";
import type { RoomRole } from "@pm/shared";
import { getMembership } from "../lib/rooms.js";

declare global {
  namespace Express {
    interface Request {
      room?: { id: number; role: RoomRole };
    }
  }
}

/** Requires `:roomId` to be a room the current user belongs to; sets `req.room`. */
export const requireRoomMember: RequestHandler<{ roomId: string }> = async (req, res, next) => {
  const roomId = Number(req.params.roomId);
  if (!Number.isInteger(roomId) || roomId <= 0) {
    res.status(400).json({ error: "Invalid room id" });
    return;
  }
  const membership = await getMembership(roomId, req.user!.id);
  if (!membership) {
    // Same answer for "doesn't exist" and "not a member" to avoid leaking room ids.
    res.status(404).json({ error: "Room not found" });
    return;
  }
  req.room = { id: roomId, role: membership.role };
  next();
};
