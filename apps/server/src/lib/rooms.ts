import { and, count, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  ROOM_ADDED_EVENT,
  userChannel,
  type Message,
  type Room,
  type RoomMember,
} from "@pm/shared";
import { db, schema } from "../db/index.js";
import { broadcast } from "./pusher.js";

const { users, rooms, roomMembers, messages, receipts } = schema;

export const userColumns = { id: users.id, username: users.username, name: users.name };

export const messageColumns = {
  id: messages.id,
  roomId: messages.roomId,
  text: messages.text,
  createdAt: messages.createdAt,
  editedAt: messages.editedAt,
  deletedAt: messages.deletedAt,
  author: userColumns,
};

type Timestamps = "createdAt" | "editedAt" | "deletedAt";

export const toMessage = (
  row: { createdAt: Date; editedAt: Date | null; deletedAt: Date | null } & Omit<Message, Timestamps>,
): Message => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  editedAt: row.editedAt?.toISOString() ?? null,
  deletedAt: row.deletedAt?.toISOString() ?? null,
});

export async function getMembership(roomId: number, userId: number) {
  const [row] = await db
    .select({ role: roomMembers.role })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function loadMembers(roomId: number): Promise<RoomMember[]> {
  return db
    .select({ role: roomMembers.role, user: userColumns })
    .from(roomMembers)
    .innerJoin(users, eq(users.id, roomMembers.userId))
    .where(eq(roomMembers.roomId, roomId))
    .orderBy(roomMembers.joinedAt);
}

/** Rooms the user belongs to (optionally only `onlyIds`), with per-user unread counts. */
export async function loadRooms(userId: number, onlyIds?: number[]): Promise<Room[]> {
  const base = await db
    .select({ id: rooms.id, name: rooms.name, createdAt: rooms.createdAt })
    .from(rooms)
    .innerJoin(roomMembers, and(eq(roomMembers.roomId, rooms.id), eq(roomMembers.userId, userId)))
    .where(onlyIds ? inArray(rooms.id, onlyIds) : undefined);
  if (base.length === 0) return [];
  const ids = base.map((r) => r.id);

  const [memberRows, lastRows, unreadRows, myReceipts] = await Promise.all([
    db
      .select({ roomId: roomMembers.roomId, role: roomMembers.role, user: userColumns })
      .from(roomMembers)
      .innerJoin(users, eq(users.id, roomMembers.userId))
      .where(inArray(roomMembers.roomId, ids))
      .orderBy(roomMembers.joinedAt),
    db
      .selectDistinctOn([messages.roomId], messageColumns)
      .from(messages)
      .innerJoin(users, eq(users.id, messages.userId))
      .where(inArray(messages.roomId, ids))
      .orderBy(messages.roomId, desc(messages.id)),
    db
      .select({ roomId: messages.roomId, count: count() })
      .from(messages)
      .leftJoin(receipts, and(eq(receipts.roomId, messages.roomId), eq(receipts.userId, userId)))
      .where(
        and(
          inArray(messages.roomId, ids),
          ne(messages.userId, userId),
          isNull(messages.deletedAt),
          gt(messages.id, sql`coalesce(${receipts.readUpTo}, 0)`),
        ),
      )
      .groupBy(messages.roomId),
    db
      .select()
      .from(receipts)
      .where(and(eq(receipts.userId, userId), inArray(receipts.roomId, ids))),
  ]);

  return base.map((r) => {
    const mine = myReceipts.find((x) => x.roomId === r.id);
    const last = lastRows.find((x) => x.roomId === r.id);
    return {
      id: r.id,
      name: r.name,
      createdAt: r.createdAt.toISOString(),
      members: memberRows.filter((m) => m.roomId === r.id).map(({ role, user }) => ({ role, user })),
      lastMessage: last ? toMessage(last) : null,
      unreadCount: unreadRows.find((x) => x.roomId === r.id)?.count ?? 0,
      myReceipt: { deliveredUpTo: mine?.deliveredUpTo ?? 0, readUpTo: mine?.readUpTo ?? 0 },
    };
  });
}

/** Tells newly added users about the room on their personal channels. */
export async function notifyAdded(roomId: number, userIds: number[]) {
  await Promise.all(
    userIds.map(async (uid) => {
      const [room] = await loadRooms(uid, [roomId]);
      if (room) broadcast(userChannel(uid), ROOM_ADDED_EVENT, room);
    }),
  ).catch((err) => console.error("notifyAdded failed:", err));
}
