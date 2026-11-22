import type { Invitation, Room, RoomInvite } from "@pm/shared";
import { forbidden, notFound } from "../../shared/errors.js";
import type { Actor } from "../../shared/http.js";
import type { Transactor } from "../../shared/transaction.js";
import type { UsersService } from "../users/index.js";
import type { ChatEvents } from "./chat.events.js";
import type { ChatViews } from "./chat.views.js";
import type { InvitesRepository } from "./invites.repository.js";
import type { MessagesRepository } from "./messages.repository.js";
import type { RoomsRepository } from "./rooms.repository.js";
import type { RoomAccess } from "./rooms.service.js";

/** Invitations: members invite people; the invited accept (and join) or decline. */
export class InvitesService {
  constructor(
    private readonly tx: Transactor,
    private readonly rooms: RoomsRepository,
    private readonly messages: MessagesRepository,
    private readonly invites: InvitesRepository,
    private readonly users: UsersService,
    private readonly views: ChatViews,
    private readonly events: ChatEvents,
  ) {}

  /**
   * Any member may invite. Unknown users, current members and people already invited are
   * skipped. Returns the room's pending invites.
   */
  async invite(actor: Actor, roomId: number, userIds: number[]): Promise<RoomInvite[]> {
    const candidates = await this.users.existingIds(userIds, actor.user.id);
    const members = new Set(await this.rooms.memberIdsAmong(roomId, candidates));
    const invited = await this.invites.create(
      roomId,
      actor.user.id,
      candidates.filter((id) => !members.has(id)),
    );
    const invites = await this.events.invitesChanged(roomId, actor.socketId);
    this.events.invitationsAdded(roomId, invited);
    return invites;
  }

  /** The owner, or whoever sent the invite, may cancel it. Returns the remaining invites. */
  async cancel(actor: Actor, room: RoomAccess, userId: number): Promise<RoomInvite[]> {
    const onlyMine = room.role === "owner" ? undefined : actor.user.id;
    if (!(await this.invites.delete(room.id, userId, onlyMine))) {
      if (await this.invites.exists(room.id, userId)) throw forbidden("Only the owner or the inviter can cancel an invite");
      throw notFound("Invite not found");
    }
    const invites = await this.events.invitesChanged(room.id, actor.socketId);
    this.events.invitationRemoved(userId, room.id);
    return invites;
  }

  /** The user's own pending invitations, newest first. */
  listFor(userId: number): Promise<Invitation[]> {
    return this.views.invitationsFor(userId);
  }

  /** Joins the room and posts a "joined the room" line. Returns the room, like creating one does. */
  async accept(actor: Actor, roomId: number): Promise<Room> {
    const me = actor.user;
    const joined = await this.tx.run(async (tx) => {
      if (!(await this.invites.withTx(tx).delete(roomId, me.id))) return null;
      // Already a member somehow: nothing to announce.
      if (!(await this.rooms.withTx(tx).addMember(roomId, me.id))) return { row: null };
      return { row: await this.messages.withTx(tx).create(roomId, me.id, "member_joined", "") };
    });
    if (!joined) throw notFound("Invitation not found");

    // Loaded after the insert, so the join line is already the room's last message.
    const [room] = await this.views.roomsFor(me.id, [roomId]);
    await this.events.membersChanged(roomId, undefined, room!.members);
    if (joined.row) this.events.messageCreated(await this.views.message(joined.row, [me]));
    this.events.invitesChangedLater(roomId);
    // My other tabs: the invitation is gone and the room appears.
    this.events.invitationRemoved(me.id, roomId, actor.socketId);
    this.events.roomAdded(roomId, [me.id]);
    return room!;
  }

  async decline(actor: Actor, roomId: number): Promise<void> {
    if (!(await this.invites.delete(roomId, actor.user.id))) throw notFound("Invitation not found");
    this.events.invitesChangedLater(roomId);
    this.events.invitationRemoved(actor.user.id, roomId, actor.socketId);
  }
}
