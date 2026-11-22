import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { RoomRole } from "@pm/shared";
import { schema } from "../../db/index.js";
import { executorOf, type DbExecutor, type TxScope } from "../../shared/transaction.js";

const { rooms, roomMembers } = schema;

export interface RoomRow {
  id: number;
  name: string;
  createdAt: Date;
}

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
  /** Members of the rooms, in the order they joined. */
  members(roomIds: number[]): Promise<MemberRow[]>;
  memberCounts(roomIds: number[]): Promise<Map<number, number>>;
  /** Which of `userIds` are members of the room. */
  memberIdsAmong(roomId: number, userIds: number[]): Promise<number[]>;
  /** Room names per member, by room id. */
  roomNamesOf(userIds: number[]): Promise<{ userId: number; roomName: string }[]>;
  /** Creates the room with `ownerId` as its owner; returns the room id. */
  create(name: string, ownerId: number): Promise<number>;
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
      .select({ id: rooms.id, name: rooms.name, createdAt: rooms.createdAt })
      .from(rooms)
      .innerJoin(roomMembers, and(eq(roomMembers.roomId, rooms.id), eq(roomMembers.userId, userId)))
      .where(onlyIds ? inArray(rooms.id, onlyIds) : undefined);
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

  async create(name: string, ownerId: number) {
    const [room] = await this.db.insert(rooms).values({ name, createdBy: ownerId }).returning({ id: rooms.id });
    await this.db.insert(roomMembers).values({ roomId: room!.id, userId: ownerId, role: "owner" });
    return room!.id;
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
