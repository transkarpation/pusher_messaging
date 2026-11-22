import type { CreateRoomInput, Room, RoomMember, RoomRole } from "@pm/shared";
import { badRequest, forbidden, notFound } from "../../shared/errors.js";
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

  listFor(userId: number): Promise<Room[]> {
    return this.views.roomsFor(userId);
  }

  async get(userId: number, roomId: number): Promise<Room> {
    const [room] = await this.views.roomsFor(userId, [roomId]);
    if (!room) throw notFound("Room not found");
    return room;
  }

  /** Creates the room with the actor as owner; `inviteIds` are invited and join once they accept. */
  async create(actor: Actor, input: { name: string; inviteIds: NonNullable<CreateRoomInput["inviteIds"]> }): Promise<Room> {
    const me = actor.user;
    const inviteIds = await this.users.existingIds(input.inviteIds, me.id);
    const roomId = await this.tx.run(async (tx) => {
      const id = await this.rooms.withTx(tx).create(input.name, me.id);
      await this.invites.withTx(tx).create(id, me.id, inviteIds);
      return id;
    });
    const room = await this.get(me.id, roomId);
    this.events.invitationsAdded(roomId, inviteIds);
    return room;
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
