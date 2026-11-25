import { and, asc, count, desc, eq, exists, inArray, or, sql, type SQL } from "drizzle-orm";
import type { AvatarContentType, RoomRole } from "@pm/shared";
import { schema } from "../../db/index.js";
import { executorOf, type DbExecutor, type TxScope } from "../../shared/transaction.js";

const { rooms, roomMembers, roomAvatars, roomInvites } = schema;

/** `avatarUrl` carries the time the picture was set, so the response can be cached forever. */
export const roomAvatarUrl: SQL<string | null> = sql<string | null>`case when ${rooms.avatarUpdatedAt} is null then null
  else '/api/rooms/' || ${rooms.id} || '/avatar?v=' || floor(extract(epoch from ${rooms.avatarUpdatedAt}) * 1000)::bigint end`;

export interface RoomAvatar {
  contentType: AvatarContentType;
  data: Buffer;
}

/** `Room.activity`: `last_activity_at` as epoch milliseconds (exact: the column keeps milliseconds). */
const roomActivity = sql<number>`(extract(epoch from ${rooms.lastActivityAt}) * 1000)::float8`.mapWith(Number);

export interface RoomRow {
  id: number;
  name: string;
  avatarUrl: string | null;
  createdAt: Date;
  activity: number;
}

const roomColumns = {
  id: rooms.id,
  name: rooms.name,
  avatarUrl: roomAvatarUrl,
  createdAt: rooms.createdAt,
  activity: roomActivity,
};

export interface MemberRow {
  roomId: number;
  userId: number;
  role: RoomRole;
}

export interface RoomsRepository {
  withTx(tx: TxScope): RoomsRepository;
  /** The user's role in the room, or null if they aren't a member. */
  membership(roomId: number, userId: number): Promise<RoomRole | null>;
  /** Rooms the user belongs to, optionally only `onlyIds`. */
  roomsOf(userId: number, onlyIds?: number[]): Promise<RoomRow[]>;
  /**
   * Up to `size` of the user's rooms, most recently active first (last activity, then id, both
   * descending), after `before` if given; and whether more follow.
   */
  pageOf(
    userId: number,
    before: { activity: number; id: number } | undefined,
    size: number,
  ): Promise<{ rows: RoomRow[]; hasMore: boolean }>;
  /** Ids of the rooms the user belongs to. */
  roomIdsOf(userId: number): Promise<number[]>;
  /** Members of the rooms, in the order they joined. */
  members(roomIds: number[]): Promise<MemberRow[]>;
  memberCounts(roomIds: number[]): Promise<Map<number, number>>;
  /** Which of `userIds` are members of the room. */
  memberIdsAmong(roomId: number, userIds: number[]): Promise<number[]>;
  /** Room names per member, by room id. */
  roomNamesOf(userIds: number[]): Promise<{ userId: number; roomName: string }[]>;
  /** Creates the room with `ownerId` as its owner and the optional picture; returns the room id. */
  create(name: string, ownerId: number, avatar?: RoomAvatar): Promise<number>;
  /**
   * Renames the room and/or replaces its picture (null removes it); fields left out stay.
   * Returns the room's name and picture URL after the change, and what actually changed.
   */
  update(
    roomId: number,
    changes: { name?: string; avatar?: RoomAvatar | null },
  ): Promise<{ name: string; avatarUrl: string | null; renamed: boolean; pictureChanged: boolean }>;
  /** The room's picture, if it has one and `viewerId` is a member or invited. */
  findAvatar(roomId: number, viewerId: number): Promise<{ contentType: string; data: Buffer } | null>;
  /** False if they were a member already. */
  addMember(roomId: number, userId: number): Promise<boolean>;
  /** False if they weren't a member. */
  removeMember(roomId: number, userId: number): Promise<boolean>;
}

export class DrizzleRoomsRepository implements RoomsRepository {
  constructor(private readonly db: DbExecutor) {}

  withTx(tx: TxScope) {
    return new DrizzleRoomsRepository(executorOf(tx));
  }

  async membership(roomId: number, userId: number) {
    const [row] = await this.db
      .select({ role: roomMembers.role })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)))
      .limit(1);
    return row?.role ?? null;
  }

  async roomsOf(userId: number, onlyIds?: number[]) {
    return this.db
      .select(roomColumns)
      .from(rooms)
      .innerJoin(roomMembers, and(eq(roomMembers.roomId, rooms.id), eq(roomMembers.userId, userId)))
      .where(onlyIds ? inArray(rooms.id, onlyIds) : undefined);
  }

  async pageOf(userId: number, before: { activity: number; id: number } | undefined, size: number) {
    const rows = await this.db
      .select(roomColumns)
      .from(rooms)
      .innerJoin(roomMembers, and(eq(roomMembers.roomId, rooms.id), eq(roomMembers.userId, userId)))
      .where(
        before
          ? sql`(${rooms.lastActivityAt}, ${rooms.id}) < (timestamptz 'epoch' + ${before.activity} * interval '1 millisecond', ${before.id})`
          : undefined,
      )
      .orderBy(desc(rooms.lastActivityAt), desc(rooms.id))
      // One extra row tells whether there's more beyond this page.
      .limit(size + 1);
    return { rows: rows.slice(0, size), hasMore: rows.length > size };
  }

  async roomIdsOf(userId: number) {
    const rows = await this.db
      .select({ roomId: roomMembers.roomId })
      .from(roomMembers)
      .where(eq(roomMembers.userId, userId));
    return rows.map((r) => r.roomId);
  }

  async members(roomIds: number[]) {
    if (roomIds.length === 0) return [];
    return this.db
      .select({ roomId: roomMembers.roomId, userId: roomMembers.userId, role: roomMembers.role })
      .from(roomMembers)
      .where(inArray(roomMembers.roomId, roomIds))
      .orderBy(roomMembers.joinedAt);
  }

  async memberCounts(roomIds: number[]) {
    if (roomIds.length === 0) return new Map<number, number>();
    const rows = await this.db
      .select({ roomId: roomMembers.roomId, count: count() })
      .from(roomMembers)
      .where(inArray(roomMembers.roomId, roomIds))
      .groupBy(roomMembers.roomId);
    return new Map(rows.map((r) => [r.roomId, r.count]));
  }

  async memberIdsAmong(roomId: number, userIds: number[]) {
    if (userIds.length === 0) return [];
    const rows = await this.db
      .select({ userId: roomMembers.userId })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), inArray(roomMembers.userId, userIds)));
    return rows.map((r) => r.userId);
  }

  async roomNamesOf(userIds: number[]) {
    if (userIds.length === 0) return [];
    return this.db
      .select({ userId: roomMembers.userId, roomName: rooms.name })
      .from(roomMembers)
      .innerJoin(rooms, eq(rooms.id, roomMembers.roomId))
      .where(inArray(roomMembers.userId, userIds))
      .orderBy(asc(rooms.id));
  }

  async create(name: string, ownerId: number, avatar?: RoomAvatar) {
    const [room] = await this.db
      .insert(rooms)
      .values({ name, createdBy: ownerId, avatarUpdatedAt: avatar ? new Date() : null })
      .returning({ id: rooms.id });
    await this.db.insert(roomMembers).values({ roomId: room!.id, userId: ownerId, role: "owner" });
    if (avatar) await this.db.insert(roomAvatars).values({ roomId: room!.id, ...avatar });
    return room!.id;
  }

  async update(roomId: number, { name, avatar }: { name?: string; avatar?: RoomAvatar | null }) {
    const [before] = await this.db
      .select({ name: rooms.name, hasAvatar: sql<boolean>`${rooms.avatarUpdatedAt} is not null` })
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .for("update");
    const renamed = name !== undefined && name !== before!.name;
    // Removing a picture the room doesn't have changes nothing; a new one always does.
    const pictureChanged = avatar === null ? before!.hasAvatar : avatar !== undefined;
    if (avatar) {
      await this.db
        .insert(roomAvatars)
        .values({ roomId, ...avatar })
        .onConflictDoUpdate({ target: roomAvatars.roomId, set: avatar });
    } else if (avatar === null) {
      await this.db.delete(roomAvatars).where(eq(roomAvatars.roomId, roomId));
    }
    const set = {
      ...(renamed ? { name } : {}),
      ...(pictureChanged ? { avatarUpdatedAt: avatar ? new Date() : null } : {}),
    };
    const columns = { name: rooms.name, avatarUrl: roomAvatarUrl };
    const [after] =
      Object.keys(set).length > 0
        ? await this.db.update(rooms).set(set).where(eq(rooms.id, roomId)).returning(columns)
        : await this.db.select(columns).from(rooms).where(eq(rooms.id, roomId));
    return { ...after!, renamed, pictureChanged };
  }

  async findAvatar(roomId: number, viewerId: number) {
    const isMember = this.db
      .select({ one: sql`1` })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, viewerId)));
    const isInvited = this.db
      .select({ one: sql`1` })
      .from(roomInvites)
      .where(and(eq(roomInvites.roomId, roomId), eq(roomInvites.userId, viewerId)));
    const [avatar] = await this.db
      .select({ contentType: roomAvatars.contentType, data: roomAvatars.data })
      .from(roomAvatars)
      .where(and(eq(roomAvatars.roomId, roomId), or(exists(isMember), exists(isInvited))))
      .limit(1);
    return avatar ?? null;
  }

  async addMember(roomId: number, userId: number) {
    const [row] = await this.db
      .insert(roomMembers)
      .values({ roomId, userId })
      .onConflictDoNothing()
      .returning({ userId: roomMembers.userId });
    return !!row;
  }

  async removeMember(roomId: number, userId: number) {
    const [row] = await this.db
      .delete(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)))
      .returning({ userId: roomMembers.userId });
    return !!row;
  }
}
