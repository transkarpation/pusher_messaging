import { ONLINE_CHANNEL, ROOM_CHANNEL_RE, USER_CHANNEL_RE, type User } from "@pm/shared";
import { badRequest, forbidden } from "../../shared/errors.js";
import type { RoomsService } from "../chat/index.js";
import type { UsersService } from "../users/index.js";
import type { ChannelGrant } from "./realtime.publisher.js";

/** Decides who may subscribe to which channel. */
export class RealtimeService {
  constructor(
    private readonly rooms: RoomsService,
    private readonly users: UsersService,
  ) {}

  /**
   * - presence-online: any signed-in user (with their profile as presence info)
   * - private-user-{id}: only that user
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
    if (userMatch && Number(userMatch[1]) === user.id) return {};

    const roomMatch = ROOM_CHANNEL_RE.exec(channel);
    if (roomMatch && (await this.rooms.membership(Number(roomMatch[1]), user.id))) return {};

    throw forbidden("Forbidden channel");
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
