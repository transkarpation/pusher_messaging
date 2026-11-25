import {
  roomsCursor,
  type Attachment,
  type Invitation,
  type Message,
  type Poll,
  type PollState,
  type Room,
  type RoomInvite,
  type RoomMember,
  type RoomsPage,
  type User,
} from "@pm/shared";
import type { BlocksService } from "../blocks/index.js";
import type { UsersService } from "../users/index.js";
import type { AttachmentsRepository } from "./attachments.repository.js";
import { toAttachment } from "./attachments.service.js";
import type { InvitesRepository } from "./invites.repository.js";
import type { MessageRow, MessagesRepository } from "./messages.repository.js";
import type { PollData, PollsRepository } from "./polls.repository.js";
import type { RoomRow, RoomsRepository } from "./rooms.repository.js";

/**
 * Builds the chat's API shapes (`Room`, `Message`, …) from repository rows. People are
 * stored as ids and attached here through the users module, never by reading its tables.
 */
export class ChatViews {
  constructor(
    private readonly rooms: RoomsRepository,
    private readonly messages: MessagesRepository,
    private readonly invites: InvitesRepository,
    private readonly attachments: AttachmentsRepository,
    private readonly polls: PollsRepository,
    private readonly users: UsersService,
    private readonly blocks: BlocksService,
  ) {}

  /**
   * Rooms the user belongs to (optionally only `onlyIds`), with their last message and
   * unread count as this user sees them (messages of people they blocked left out).
   */
  async roomsFor(userId: number, onlyIds?: number[]): Promise<Room[]> {
    return this.roomViews(userId, await this.rooms.roomsOf(userId, onlyIds));
  }

  /** A page of the user's rooms, most recently active first (see `RoomsRepository.pageOf`). */
  async roomsPage(userId: number, before: { activity: number; id: number } | undefined, size: number): Promise<RoomsPage> {
    const { rows, hasMore } = await this.rooms.pageOf(userId, before, size);
    const rooms = await this.roomViews(userId, rows);
    const last = rows[rows.length - 1];
    return { rooms, nextCursor: hasMore && last ? roomsCursor(last) : null };
  }

  /** `Room`s for the rows, in the same order. */
  private async roomViews(userId: number, base: RoomRow[]): Promise<Room[]> {
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
    const [users, files, polls] = await Promise.all([
      this.users.getByIds([
        ...memberRows.map((m) => m.userId),
        ...latestRows.map((m) => m.userId),
        ...inviteRows.flatMap((i) => (i.invitedBy === null ? [i.userId] : [i.userId, i.invitedBy])),
      ]),
      this.attachmentsOf(latestRows),
      this.pollsOf(latestRows, userId),
    ]);
    const invites = this.toInvites(inviteRows, users);

    return base.map((r) => {
      const mine = myReceipts.find((x) => x.roomId === r.id);
      const last = latestRows.find((x) => x.roomId === r.id);
      return {
        id: r.id,
        name: r.name,
        avatarUrl: r.avatarUrl,
        createdAt: r.createdAt.toISOString(),
        members: memberRows
          .filter((m) => m.roomId === r.id)
          .flatMap((m) => withUser(users, m.userId, (user) => ({ role: m.role, user }))),
        invites: invites.filter((i) => i.roomId === r.id).map(({ roomId: _, ...invite }) => invite),
        lastMessage: (last && this.toMessage(last, users, files, polls)) ?? null,
        unreadCount: unread.get(r.id) ?? 0,
        myReceipt: { deliveredUpTo: mine?.deliveredUpTo ?? 0, readUpTo: mine?.readUpTo ?? 0 },
        activity: r.activity,
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
      roomAvatarUrl: r.roomAvatarUrl,
      invitedBy: r.invitedBy === null ? null : (users.get(r.invitedBy) ?? null),
      createdAt: r.createdAt.toISOString(),
      memberCount: counts.get(r.roomId) ?? 0,
    }));
  }

  /**
   * Attaches authors, files and polls; `known` saves the lookup for users already at hand (e.g. the
   * sender). Polls are as `viewerId` sees them (their own votes in `myVotes`; none without a viewer).
   */
  async messageList(rows: MessageRow[], known: User[] = [], viewerId?: number): Promise<Message[]> {
    const users = new Map(known.map((u) => [u.id, u]));
    const missing = rows.map((r) => r.userId).filter((id) => !users.has(id));
    const [found, files, polls] = await Promise.all([
      missing.length > 0 ? this.users.getByIds(missing) : new Map<number, User>(),
      this.attachmentsOf(rows),
      this.pollsOf(rows, viewerId),
    ]);
    for (const [id, u] of found) users.set(id, u);
    return rows.flatMap((r) => this.toMessage(r, users, files, polls) ?? []);
  }

  /** The poll in message `messageId` as `viewerId` sees it, or null if there's none. */
  async poll(messageId: number, viewerId: number): Promise<Poll | null> {
    return (await this.buildPolls(await this.polls.load([messageId]), viewerId)).get(messageId) ?? null;
  }

  /** Polls of the live "poll" messages among `rows`, by message id. */
  private async pollsOf(rows: MessageRow[], viewerId?: number): Promise<Map<number, Poll>> {
    const ids = rows.filter((r) => r.kind === "poll" && !r.deletedAt).map((r) => r.id);
    if (ids.length === 0) return new Map();
    return this.buildPolls(await this.polls.load(ids), viewerId);
  }

  private async buildPolls(data: PollData, viewerId?: number): Promise<Map<number, Poll>> {
    const anonymous = new Set(data.polls.filter((p) => p.anonymous).map((p) => p.messageId));
    const users = await this.users.getByIds([
      ...data.options.flatMap((o) => (o.addedBy === null ? [] : [o.addedBy])),
      ...data.votes.filter((v) => !anonymous.has(v.messageId)).map((v) => v.userId),
      ...data.comments.map((c) => c.userId),
    ]);
    const result = new Map<number, Poll>();
    for (const p of data.polls) {
      const votes = data.votes.filter((v) => v.messageId === p.messageId);
      const state: PollState = {
        question: p.question,
        multiple: p.multiple,
        maxVotes: p.maxVotes,
        anonymous: p.anonymous,
        allowSuggestions: p.allowSuggestions,
        allowComments: p.allowComments,
        options: data.options
          .filter((o) => o.messageId === p.messageId)
          .map((o) => {
            const forOption = votes.filter((v) => v.optionId === o.id);
            return {
              id: o.id,
              text: o.text,
              voteCount: forOption.length,
              // Never sent for an anonymous poll, not even to its author.
              voters: p.anonymous ? [] : forOption.flatMap((v) => users.get(v.userId) ?? []),
              addedBy: o.addedBy === null ? null : (users.get(o.addedBy) ?? null),
            };
          }),
        voterCount: new Set(votes.map((v) => v.userId)).size,
        comments: data.comments
          .filter((c) => c.messageId === p.messageId)
          .flatMap((c) =>
            withUser(users, c.userId, (author) => ({ id: c.id, author, text: c.text, createdAt: c.createdAt.toISOString() })),
          ),
        version: p.version,
      };
      const myVotes = viewerId === undefined ? [] : votes.filter((v) => v.userId === viewerId).map((v) => v.optionId);
      result.set(p.messageId, { ...state, myVotes });
    }
    return result;
  }

  /** Attachments of the live regular messages among `rows`, by message id. */
  private async attachmentsOf(rows: MessageRow[]): Promise<Map<number, Attachment[]>> {
    const ids = rows.filter((r) => r.kind === "text" && !r.deletedAt).map((r) => r.id);
    const byMessage = new Map<number, Attachment[]>();
    for (const a of await this.attachments.forMessages(ids)) {
      const list = byMessage.get(a.messageId!) ?? [];
      list.push(toAttachment(a));
      byMessage.set(a.messageId!, list);
    }
    return byMessage;
  }

  async message(row: MessageRow, known: User[] = [], viewerId?: number): Promise<Message> {
    const [message] = await this.messageList([row], known, viewerId);
    return message!;
  }

  private toMessage(
    row: MessageRow,
    users: Map<number, User>,
    files: Map<number, Attachment[]>,
    polls: Map<number, Poll>,
  ): Message | undefined {
    const author = users.get(row.userId);
    if (!author) return undefined; // the account was deleted mid-request
    const { userId: _, ...rest } = row;
    return {
      ...rest,
      createdAt: row.createdAt.toISOString(),
      editedAt: row.editedAt?.toISOString() ?? null,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      attachments: files.get(row.id) ?? [],
      author,
      poll: polls.get(row.id) ?? null,
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
