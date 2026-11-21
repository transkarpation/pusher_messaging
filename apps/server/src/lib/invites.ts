import type { Request } from "express";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  INVITATION_ADDED_EVENT,
  INVITATION_REMOVED_EVENT,
  ROOM_INVITES_EVENT,
  roomChannel,
  userChannel,
  type Invitation,
  type InvitationRemovedEvent,
  type RoomInvite,
  type RoomInvitesEvent,
} from "@pm/shared";
import { db, schema } from "../db/index.js";
import { broadcast } from "./pusher.js";

const { users, rooms, roomMembers, roomInvites } = schema;
const userColumns = { id: users.id, username: users.username, name: users.name };
const inviter = alias(users, "inviter");
const inviterColumns = { id: inviter.id, username: inviter.username, name: inviter.name };

/** Pending invites of the given rooms, oldest first, with the room id on each row. */
export async function loadRoomInvites(roomIds: number[]): Promise<(RoomInvite & { roomId: number })[]> {
  if (roomIds.length === 0) return [];
  const rows = await db
    .select({
      roomId: roomInvites.roomId,
      user: userColumns,
      invitedBy: inviterColumns,
      createdAt: roomInvites.createdAt,
    })
    .from(roomInvites)
    .innerJoin(users, eq(users.id, roomInvites.userId))
    .leftJoin(inviter, eq(inviter.id, roomInvites.invitedBy))
    .where(inArray(roomInvites.roomId, roomIds))
    .orderBy(roomInvites.createdAt);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/** The user's pending invitations (optionally only to `onlyRoomIds`), newest first. */
export async function loadInvitations(userId: number, onlyRoomIds?: number[]): Promise<Invitation[]> {
  const rows = await db
    .select({
      roomId: rooms.id,
      roomName: rooms.name,
      invitedBy: inviterColumns,
      createdAt: roomInvites.createdAt,
    })
    .from(roomInvites)
    .innerJoin(rooms, eq(rooms.id, roomInvites.roomId))
    .leftJoin(inviter, eq(inviter.id, roomInvites.invitedBy))
    .where(
      and(
        eq(roomInvites.userId, userId),
        onlyRoomIds ? inArray(roomInvites.roomId, onlyRoomIds) : undefined,
      ),
    )
    .orderBy(desc(roomInvites.createdAt));
  if (rows.length === 0) return [];

  const counts = await db
    .select({ roomId: roomMembers.roomId, count: count() })
    .from(roomMembers)
    .where(inArray(roomMembers.roomId, rows.map((r) => r.roomId)))
    .groupBy(roomMembers.roomId);

  return rows.map((r) => ({
    ...r,
    memberCount: counts.find((c) => c.roomId === r.roomId)?.count ?? 0,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Invites `userIds` to the room, skipping current members and people already invited.
 * Returns the ids actually invited.
 */
export async function createInvites(roomId: number, invitedBy: number, userIds: number[]): Promise<number[]> {
  if (userIds.length === 0) return [];
  const members = await db
    .select({ userId: roomMembers.userId })
    .from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), inArray(roomMembers.userId, userIds)));
  const memberIds = new Set(members.map((m) => m.userId));
  const candidates = userIds.filter((id) => !memberIds.has(id));
  if (candidates.length === 0) return [];

  const rows = await db
    .insert(roomInvites)
    .values(candidates.map((userId) => ({ roomId, userId, invitedBy })))
    .onConflictDoNothing()
    .returning({ userId: roomInvites.userId });
  return rows.map((r) => r.userId);
}

/** Tells room members the current pending invites; returns them. */
export async function broadcastRoomInvites(roomId: number, req?: Request): Promise<RoomInvite[]> {
  const invites = (await loadRoomInvites([roomId])).map(({ roomId: _, ...i }) => i);
  const event: RoomInvitesEvent = { roomId, invites };
  broadcast(roomChannel(roomId), ROOM_INVITES_EVENT, event, req);
  return invites;
}

/** Sends each newly invited user their invitation on their personal channel. */
export async function notifyInvited(roomId: number, userIds: number[]) {
  await Promise.all(
    userIds.map(async (uid) => {
      const [invitation] = await loadInvitations(uid, [roomId]);
      if (invitation) broadcast(userChannel(uid), INVITATION_ADDED_EVENT, invitation);
    }),
  ).catch((err) => console.error("notifyInvited failed:", err));
}

/** Tells the user (all their tabs) that an invitation is gone. */
export function notifyInvitationRemoved(userId: number, roomId: number, req?: Request) {
  const event: InvitationRemovedEvent = { roomId };
  broadcast(userChannel(userId), INVITATION_REMOVED_EVENT, event, req);
}
