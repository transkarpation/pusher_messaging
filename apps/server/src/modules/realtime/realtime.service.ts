import { ONLINE_CHANNEL, ROOM_CHANNEL_RE, USER_CHANNEL_RE, type User } from "@pm/shared";
import { z } from "zod";
import { badRequest, forbidden } from "../../shared/errors.js";
import { parse } from "../../shared/http.js";
import type { RoomsService } from "../chat/index.js";
import type { UsersService } from "../users/index.js";
import type { ChannelGrant } from "./realtime.publisher.js";

const userIds = z.array(z.number().int().positive()).max(100_000).default([]);
/** Body of POST /api/realtime/phoenix/seen. */
const seenSchema = z.object({ online: userIds, left: userIds });

/** Decides who may subscribe to which channel, and records when people were last connected. */
export class RealtimeService {
  constructor(
    private readonly rooms: RoomsService,
    private readonly users: UsersService,
  ) {}

  /**
   * - presence-online: any signed-in user (with their profile as presence info)
   * - private-user-{id}: only that user (with their room ids, for the rooms' activity)
   * - private-room-{id}: only members of the room
   *
   * Throws 403 for anything else.
   */
  async authorize(user: User, channel: string): Promise<ChannelGrant> {
    if (channel === ONLINE_CHANNEL) {
      return {
        presence: {
          id: String(user.id),
          info: { username: user.username, name: user.name, avatarUrl: user.avatarUrl },
        },
      };
    }

    const userMatch = USER_CHANNEL_RE.exec(channel);
    if (userMatch && Number(userMatch[1]) === user.id) return { roomActivity: await this.rooms.roomIdsOf(user.id) };

    const roomMatch = ROOM_CHANNEL_RE.exec(channel);
    if (roomMatch && (await this.rooms.membership(Number(roomMatch[1]), user.id))) return {};

    throw forbidden("Forbidden channel");
  }

  /**
   * The Phoenix server reports who is connected (`online`, about once a minute) and whose
   * last connection just closed (`left`).
   */
  async recordSeen(body: unknown): Promise<void> {
    const { online, left } = parse(seenSchema, body);
    await this.users.markSeen(online, left);
  }

  /** `authorize` for a user known only by id (the Phoenix server asks this way). */
  async authorizeUserId(userId: unknown, channel: unknown): Promise<ChannelGrant> {
    if (typeof userId !== "number" || !Number.isSafeInteger(userId) || typeof channel !== "string") {
      throw badRequest("userId and channel are required");
    }
    const user = await this.users.getById(userId);
    if (!user) throw forbidden("Unknown user");
    return this.authorize(user, channel);
  }
}
