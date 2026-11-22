import { ONLINE_CHANNEL, ROOM_CHANNEL_RE, USER_CHANNEL_RE, type User } from "@pm/shared";
import { forbidden } from "../../shared/errors.js";
import type { RoomsService } from "../chat/index.js";
import type { ChannelGrant } from "./realtime.publisher.js";

/** Decides who may subscribe to which channel. */
export class RealtimeService {
  constructor(private readonly rooms: RoomsService) {}

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
}
