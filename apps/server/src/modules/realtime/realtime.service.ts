import { ONLINE_CHANNEL, ROOM_CHANNEL_RE, USER_CHANNEL_RE, type PresenceUserInfo, type User } from "@pm/shared";
import { forbidden } from "../../shared/errors.js";
import type { RoomsService } from "../chat/index.js";
import type { ChannelAuthorizer } from "./realtime.publisher.js";

/** Decides who may subscribe to which channel. */
export class RealtimeService {
  constructor(
    private readonly authorizer: ChannelAuthorizer,
    private readonly rooms: RoomsService,
  ) {}

  /**
   * - presence-online: any signed-in user (with their profile as presence info)
   * - private-user-{id}: only that user
   * - private-room-{id}: only members of the room
   */
  async authorize(user: User, socketId: string, channel: string): Promise<object> {
    if (channel === ONLINE_CHANNEL) {
      const userInfo: PresenceUserInfo = { username: user.username, name: user.name, avatarUrl: user.avatarUrl };
      return this.authorizer.authorize(socketId, channel, { userId: String(user.id), userInfo });
    }

    const userMatch = USER_CHANNEL_RE.exec(channel);
    if (userMatch && Number(userMatch[1]) === user.id) return this.authorizer.authorize(socketId, channel);

    const roomMatch = ROOM_CHANNEL_RE.exec(channel);
    if (roomMatch && (await this.rooms.membership(Number(roomMatch[1]), user.id))) {
      return this.authorizer.authorize(socketId, channel);
    }

    throw forbidden("Forbidden channel");
  }
}
