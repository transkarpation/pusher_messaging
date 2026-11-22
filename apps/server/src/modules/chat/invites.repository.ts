import { and, desc, eq, inArray } from "drizzle-orm";
import { schema } from "../../db/index.js";
import { executorOf, type DbExecutor, type TxScope } from "../../shared/transaction.js";
import { roomAvatarUrl } from "./rooms.repository.js";

const { rooms, roomInvites } = schema;

export interface InviteRow {
  roomId: number;
  userId: number;
  /** Null if the inviter's account was deleted. */
  invitedBy: number | null;
  createdAt: Date;
}

export interface InvitationRow {
  roomId: number;
  roomName: string;
  roomAvatarUrl: string | null;
  invitedBy: number | null;
  createdAt: Date;
}

export interface InvitesRepository {
  withTx(tx: TxScope): InvitesRepository;
  /** Pending invites of the rooms, oldest first. */
  forRooms(roomIds: number[]): Promise<InviteRow[]>;
  /** The user's pending invitations (optionally only to `onlyRoomIds`), newest first. */
  forUser(userId: number, onlyRoomIds?: number[]): Promise<InvitationRow[]>;
  /** Invites `userIds`, skipping those invited already; returns the ids actually invited. */
  create(roomId: number, invitedBy: number, userIds: number[]): Promise<number[]>;
  /** Deletes the invite (only one sent by `onlyInvitedBy`, if given); false if none matched. */
  delete(roomId: number, userId: number, onlyInvitedBy?: number): Promise<boolean>;
  exists(roomId: number, userId: number): Promise<boolean>;
}

export class DrizzleInvitesRepository implements InvitesRepository {
  constructor(private readonly db: DbExecutor) {}

  withTx(tx: TxScope) {
    return new DrizzleInvitesRepository(executorOf(tx));
  }

  async forRooms(roomIds: number[]) {
    if (roomIds.length === 0) return [];
    return this.db
      .select({
        roomId: roomInvites.roomId,
        userId: roomInvites.userId,
        invitedBy: roomInvites.invitedBy,
        createdAt: roomInvites.createdAt,
      })
      .from(roomInvites)
      .where(inArray(roomInvites.roomId, roomIds))
      .orderBy(roomInvites.createdAt);
  }

  async forUser(userId: number, onlyRoomIds?: number[]) {
    return this.db
      .select({
        roomId: rooms.id,
        roomName: rooms.name,
        roomAvatarUrl,
        invitedBy: roomInvites.invitedBy,
        createdAt: roomInvites.createdAt,
      })
      .from(roomInvites)
      .innerJoin(rooms, eq(rooms.id, roomInvites.roomId))
      .where(and(eq(roomInvites.userId, userId), onlyRoomIds ? inArray(roomInvites.roomId, onlyRoomIds) : undefined))
      .orderBy(desc(roomInvites.createdAt));
  }

  async create(roomId: number, invitedBy: number, userIds: number[]) {
    if (userIds.length === 0) return [];
    const rows = await this.db
      .insert(roomInvites)
      .values(userIds.map((userId) => ({ roomId, userId, invitedBy })))
      .onConflictDoNothing()
      .returning({ userId: roomInvites.userId });
    return rows.map((r) => r.userId);
  }

  async delete(roomId: number, userId: number, onlyInvitedBy?: number) {
    const [row] = await this.db
      .delete(roomInvites)
      .where(
        and(
          eq(roomInvites.roomId, roomId),
          eq(roomInvites.userId, userId),
          onlyInvitedBy === undefined ? undefined : eq(roomInvites.invitedBy, onlyInvitedBy),
        ),
      )
      .returning({ userId: roomInvites.userId });
    return !!row;
  }

  async exists(roomId: number, userId: number) {
    const [row] = await this.db
      .select({ userId: roomInvites.userId })
      .from(roomInvites)
      .where(and(eq(roomInvites.roomId, roomId), eq(roomInvites.userId, userId)))
      .limit(1);
    return !!row;
  }
}
