import {
  AVATAR_MAX_BYTES,
  MAX_PINNED_ROOMS,
  type CreateRoomInput,
  type MessageKind,
  type Room,
  type RoomMember,
  type RoomRole,
  type RoomPinnedEvent,
  type RoomsPage,
  type RoomUpdatedEvent,
} from "@pm/shared";
import { badRequest, conflict, forbidden, notFound } from "../../shared/errors.js";
import { sniffImageType } from "../../shared/images.js";
import type { Actor } from "../../shared/http.js";
import type { Transactor } from "../../shared/transaction.js";
import type { UsersService } from "../users/index.js";
import type { ChatEvents } from "./chat.events.js";
import type { ChatViews } from "./chat.views.js";
import type { InvitesRepository } from "./invites.repository.js";
import type { MessagesRepository } from "./messages.repository.js";
import type { RoomsRepository } from "./rooms.repository.js";

/** A room the actor belongs to, and their role in it (checked at the HTTP edge). */
export interface RoomAccess {
  id: number;
  role: RoomRole;
}

/** The chat module's facade for rooms and membership. */
export class RoomsService {
  constructor(
    private readonly tx: Transactor,
    private readonly rooms: RoomsRepository,
    private readonly messages: MessagesRepository,
    private readonly invites: InvitesRepository,
    private readonly users: UsersService,
    private readonly views: ChatViews,
    private readonly events: ChatEvents,
  ) {}

  /** The user's role in the room, or null if they aren't a member. */
  membership(roomId: number, userId: number): Promise<RoomRole | null> {
    return this.rooms.membership(roomId, userId);
  }

  /** A page of the user's rooms (with `unread`, only those with unread messages), most recently active first. */
  listFor(
    userId: number,
    query: { limit: number; before?: { activity: number; id: number }; unread: boolean },
  ): Promise<RoomsPage> {
    return this.views.roomsPage(userId, query.before, query.limit, query.unread);
  }

  /**
   * Pins the room to the top of the actor's room list (pinning it again moves it to the first
   * place), or unpins it. At most MAX_PINNED_ROOMS; the actor's other tabs and devices are told.
   */
  async setPinned(actor: Actor, roomId: number, pinned: boolean): Promise<RoomPinnedEvent> {
    const result = await this.rooms.setPinned(roomId, actor.user.id, pinned, MAX_PINNED_ROOMS);
    if (!result.ok) {
      throw result.reason === "limit"
        ? conflict(`You can pin up to ${MAX_PINNED_ROOMS} rooms. Unpin one first.`)
        : notFound("Room not found");
    }
    const event: RoomPinnedEvent = { roomId, pinnedAt: result.pinnedAt?.toISOString() ?? null };
    this.events.roomPinned(actor.user.id, event, actor.socketId);
    return event;
  }

  /** Ids of the user's rooms with unread messages. */
  unreadRoomIds(userId: number): Promise<number[]> {
    return this.views.unreadRoomIds(userId);
  }

  /** Ids of the rooms the user belongs to. */
  roomIdsOf(userId: number): Promise<number[]> {
    return this.rooms.roomIdsOf(userId);
  }

  async get(userId: number, roomId: number): Promise<Room> {
    const [room] = await this.views.roomsFor(userId, [roomId]);
    if (!room) throw notFound("Room not found");
    return room;
  }

  /** Creates the room with the actor as owner; `inviteIds` are invited and join once they accept. */
  /** `avatar`: the room's picture, base64-encoded; its type is taken from the bytes. */
  async create(
    actor: Actor,
    input: { name: string; inviteIds: NonNullable<CreateRoomInput["inviteIds"]>; avatar?: string },
  ): Promise<Room> {
    const me = actor.user;
    const avatar = input.avatar ? decodeAvatar(input.avatar) : undefined;
    const inviteIds = await this.users.existingIds(input.inviteIds, me.id);
    const roomId = await this.tx.run(async (tx) => {
      const id = await this.rooms.withTx(tx).create(input.name, me.id, avatar);
      await this.invites.withTx(tx).create(id, me.id, inviteIds);
      return id;
    });
    const room = await this.get(me.id, roomId);
    this.events.invitationsAdded(roomId, inviteIds);
    return room;
  }

  /**
   * The owner renames the room and/or changes its picture (`avatar`: base64, or null to remove
   * it). Each actual change posts a system line; members get `room:updated`, and people
   * invited get their invitation again with the new name and picture.
   */
  async update(actor: Actor, room: RoomAccess, input: { name?: string; avatar?: string | null }): Promise<RoomUpdatedEvent> {
    if (room.role !== "owner") throw forbidden("Only the owner can change the room");
    const avatar = typeof input.avatar === "string" ? decodeAvatar(input.avatar) : input.avatar;
    const { result, lines } = await this.tx.run(async (tx) => {
      const result = await this.rooms.withTx(tx).update(room.id, { name: input.name, avatar });
      const kinds: [MessageKind, string][] = [];
      if (result.renamed) kinds.push(["room_renamed", result.name]);
      if (result.pictureChanged) kinds.push([avatar ? "room_picture_changed" : "room_picture_removed", ""]);
      const messages = this.messages.withTx(tx);
      const lines = [];
      for (const [kind, text] of kinds) lines.push(await messages.create(room.id, actor.user.id, kind, text));
      return { result, lines };
    });

    const event: RoomUpdatedEvent = { roomId: room.id, name: result.name, avatarUrl: result.avatarUrl };
    if (lines.length === 0) return event;
    // Also to the actor's own connection: the response doesn't carry the system lines.
    this.events.roomUpdated(event);
    for (const line of lines) this.events.messageCreated(await this.views.message(line, [actor.user]));
    const invited = await this.invites.forRooms([room.id]);
    this.events.invitationsAdded(room.id, invited.map((i) => i.userId));
    return event;
  }

  /** The room's picture, for its members and the people invited to it. */
  async getAvatar(viewerId: number, roomId: number) {
    const avatar = await this.rooms.findAvatar(roomId, viewerId);
    if (!avatar) throw notFound("Not found");
    return avatar;
  }

  /**
   * The owner may remove anyone else; any non-owner may remove themselves (leave), which
   * posts a "left the room" line. Returns the remaining members.
   */
  async removeMember(actor: Actor, room: RoomAccess, targetId: number): Promise<RoomMember[]> {
    const self = targetId === actor.user.id;
    if (self && room.role === "owner") throw badRequest("The owner can't leave the room");
    if (!self && room.role !== "owner") throw forbidden("Only the owner can remove members");

    const left = await this.tx.run(async (tx) => {
      if (!(await this.rooms.withTx(tx).removeMember(room.id, targetId))) return null;
      return { row: self ? await this.messages.withTx(tx).create(room.id, targetId, "member_left", "") : null };
    });
    if (!left) throw notFound("Not a member");

    const members = await this.events.membersChanged(room.id, actor.socketId);
    if (left.row) this.events.messageCreated(await this.views.message(left.row, [actor.user]), actor.socketId);
    this.events.roomRemoved(targetId, room.id);
    return members;
  }

  /** Relays the actor's typing state to the other members. */
  typing(actor: Actor, roomId: number, typing: boolean) {
    this.events.typing({ roomId, userId: actor.user.id, typing }, actor.socketId);
  }

  /** Names of the rooms each user is in, by room id. */
  async roomNamesByUser(userIds: number[]): Promise<Map<number, string[]>> {
    const names = new Map<number, string[]>(userIds.map((id) => [id, []]));
    for (const row of await this.rooms.roomNamesOf(userIds)) names.get(row.userId)?.push(row.roomName);
    return names;
  }
}

/** A base64 PNG, JPEG or WebP image up to `AVATAR_MAX_BYTES`. */
function decodeAvatar(base64: string) {
  const data = Buffer.from(base64, "base64");
  if (data.length > AVATAR_MAX_BYTES) throw badRequest("The picture is too large");
  const contentType = sniffImageType(data);
  if (!contentType) throw badRequest("The picture must be a PNG, JPEG or WebP image");
  return { contentType, data };
}
