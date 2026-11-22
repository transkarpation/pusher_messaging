import { Router } from "express";
import {
  ONLINE_CHANNEL,
  ROOM_CHANNEL_RE,
  USER_CHANNEL_RE,
  type PresenceUserInfo,
  type RealtimeConfig,
} from "@pm/shared";
import { pusher, pusherConfig } from "../lib/pusher.js";
import { getMembership } from "../lib/rooms.js";
import { requireAuth } from "../middleware/auth.js";

export const realtimeRouter = Router();

realtimeRouter.get("/config", (_req, res) => {
  const config: RealtimeConfig = {
    pusher: { key: pusherConfig.key, cluster: pusherConfig.cluster },
  };
  res.json(config);
});

/**
 * Pusher channel authorization (pusher-js posts socket_id + channel_name):
 * - presence-online: any signed-in user
 * - private-user-{id}: only that user
 * - private-room-{id}: only members of the room
 */
realtimeRouter.post("/pusher/auth", requireAuth, async (req, res) => {
  const { socket_id: socketId, channel_name: channel } = req.body ?? {};
  if (typeof socketId !== "string" || typeof channel !== "string") {
    res.status(400).json({ error: "socket_id and channel_name are required" });
    return;
  }
  const user = req.user!;

  if (channel === ONLINE_CHANNEL) {
    const userInfo: PresenceUserInfo = { username: user.username, name: user.name, avatarUrl: user.avatarUrl };
    res.json(pusher.authorizeChannel(socketId, channel, { user_id: String(user.id), user_info: userInfo }));
    return;
  }

  const userMatch = USER_CHANNEL_RE.exec(channel);
  if (userMatch && Number(userMatch[1]) === user.id) {
    res.json(pusher.authorizeChannel(socketId, channel));
    return;
  }

  const roomMatch = ROOM_CHANNEL_RE.exec(channel);
  if (roomMatch && (await getMembership(Number(roomMatch[1]), user.id))) {
    res.json(pusher.authorizeChannel(socketId, channel));
    return;
  }

  res.status(403).json({ error: "Forbidden channel" });
});
