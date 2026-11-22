import type { Invitation, Message, Room, RoomInvite, RoomMember, User } from "@pm/shared";
import type { BlocksService } from "../blocks/index.js";
import type { UsersService } from "../users/index.js";
import type { InvitesRepository } from "./invites.repository.js";
import type { MessageRow, MessagesRepository } from "./messages.repository.js";
import type { RoomsRepository } from "./rooms.repository.js";

/**
 * Builds the chat's API shapes (`Room`, `Message`, …) from repository rows. People are
 * stored as ids and attached here through the users module, never by reading its tables.
 */
export class ChatViews {
  constructor(
    private readonly rooms: RoomsRepository,
    private readonly messages: MessagesRepository,
    private readonly invites: InvitesRepository,
    private readonly users: UsersService,
    private readonly blocks: BlocksService,
  ) {}

  /**
   * Rooms the user belongs to (optionally only `onlyIds`), with their last message and
   * unread count as this user sees them (messages of people they blocked left out).
   */
  async roomsFor(userId: number, onlyIds?: number[]): Promise<Room[]> {
    const base = await this.rooms.roomsOf(userId, onlyIds);
    if (base.length === 0) return [];
    const ids = base.map((r) => r.id);
    const hidden = await this.blocks.blockedIds(userId);

    const [memberRows, latestRows, unread, myReceipts, inviteRows] = await Promise.all([
      this.rooms.members(ids),
      this.messages.latest(ids, hidden),
      this.messages.unreadCounts(userId, ids, hidden),
      this.messages.userReceipts(userId, ids),
      this.invites.forRooms(ids),
    ]);
    const users = await this.users.getByIds([
      ...memberRows.map((m) => m.userId),
      ...latestRows.map((m) => m.userId),
      ...inviteRows.flatMap((i) => (i.invitedBy === null ? [i.userId] : [i.userId, i.invitedBy])),
    ]);
    const invites = this.toInvites(inviteRows, users);

    return base.map((r) => {
      const mine = myReceipts.find((x) => x.roomId === r.id);
      const last = latestRows.find((x) => x.roomId === r.id);
      return {
        id: r.id,
        name: r.name,
        createdAt: r.createdAt.toISOString(),
        members: memberRows
          .filter((m) => m.roomId === r.id)
          .flatMap((m) => withUser(users, m.userId, (user) => ({ role: m.role, user }))),
        invites: invites.filter((i) => i.roomId === r.id).map(({ roomId: _, ...invite }) => invite),
        lastMessage: (last && this.toMessage(last, users)) ?? null,
        unreadCount: unread.get(r.id) ?? 0,
        myReceipt: { deliveredUpTo: mine?.deliveredUpTo ?? 0, readUpTo: mine?.readUpTo ?? 0 },
      };
    });
  }

  async members(roomId: number): Promise<RoomMember[]> {
    const rows = await this.rooms.members([roomId]);
    const users = await this.users.getByIds(rows.map((m) => m.userId));
    return rows.flatMap((m) => withUser(users, m.userId, (user) => ({ role: m.role, user })));
  }

  /** Pending invites of a room, oldest first. */
  async roomInvites(roomId: number): Promise<RoomInvite[]> {
    const rows = await this.invites.forRooms([roomId]);
    const users = await this.users.getByIds(rows.flatMap((i) => (i.invitedBy === null ? [i.userId] : [i.userId, i.invitedBy])));
    return this.toInvites(rows, users).map(({ roomId: _, ...invite }) => invite);
  }

  /** The user's pending invitations (optionally only to `onlyRoomIds`), newest first. */
  async invitationsFor(userId: number, onlyRoomIds?: number[]): Promise<Invitation[]> {
    const rows = await this.invites.forUser(userId, onlyRoomIds);
    if (rows.length === 0) return [];
    const [counts, users] = await Promise.all([
      this.rooms.memberCounts(rows.map((r) => r.roomId)),
      this.users.getByIds(rows.flatMap((r) => (r.invitedBy === null ? [] : [r.invitedBy]))),
    ]);
    return rows.map((r) => ({
      roomId: r.roomId,
      roomName: r.roomName,
      invitedBy: r.invitedBy === null ? null : (users.get(r.invitedBy) ?? null),
      createdAt: r.createdAt.toISOString(),
      memberCount: counts.get(r.roomId) ?? 0,
    }));
  }

  /** Attaches authors; `known` saves the lookup for users already at hand (e.g. the sender). */
  async messageList(rows: MessageRow[], known: User[] = []): Promise<Message[]> {
    const users = new Map(known.map((u) => [u.id, u]));
    const missing = rows.map((r) => r.userId).filter((id) => !users.has(id));
    if (missing.length > 0) for (const [id, u] of await this.users.getByIds(missing)) users.set(id, u);
    return rows.flatMap((r) => this.toMessage(r, users) ?? []);
  }

  async message(row: MessageRow, known: User[] = []): Promise<Message> {
    const [message] = await this.messageList([row], known);
    return message!;
  }

  private toMessage(row: MessageRow, users: Map<number, User>): Message | undefined {
    const author = users.get(row.userId);
    if (!author) return undefined; // the account was deleted mid-request
    const { userId: _, ...rest } = row;
    return {
      ...rest,
      createdAt: row.createdAt.toISOString(),
      editedAt: row.editedAt?.toISOString() ?? null,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      author,
    };
  }

  private toInvites(
    rows: { roomId: number; userId: number; invitedBy: number | null; createdAt: Date }[],
    users: Map<number, User>,
  ): (RoomInvite & { roomId: number })[] {
    return rows.flatMap((i) =>
      withUser(users, i.userId, (user) => ({
        roomId: i.roomId,
        user,
        invitedBy: i.invitedBy === null ? null : (users.get(i.invitedBy) ?? null),
        createdAt: i.createdAt.toISOString(),
      })),
    );
  }
}

/** `make(user)` if the user exists, else nothing (an account deleted mid-request). */
const withUser = <T>(users: Map<number, User>, id: number, make: (user: User) => T): T[] => {
  const user = users.get(id);
  return user ? [make(user)] : [];
};
