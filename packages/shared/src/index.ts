import { z } from "zod";

export const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(32, "Username must be at most 32 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username may contain only letters, digits and _"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long"),
});
export type Credentials = z.infer<typeof credentialsSchema>;

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(64, "Name is too long"),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const createMessageSchema = z.object({
  text: z.string().trim().min(1, "Message is empty").max(2000, "Message is too long"),
});
export type CreateMessageInput = z.infer<typeof createMessageSchema>;

export const updateMessageSchema = createMessageSchema;
export type UpdateMessageInput = z.infer<typeof updateMessageSchema>;

const userIds = z.array(z.number().int().positive()).max(100, "Too many users");

export const createRoomSchema = z.object({
  name: z.string().trim().min(1, "Room name is required").max(64, "Room name is too long"),
  /** People to invite; they join once they accept. */
  inviteIds: userIds.default([]),
});
export type CreateRoomInput = z.input<typeof createRoomSchema>;

export const inviteSchema = z.object({
  userIds: userIds.min(1, "Pick at least one person"),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export interface User {
  id: number;
  username: string;
  name: string | null;
}

export interface Message {
  id: number;
  roomId: number;
  text: string;
  createdAt: string;
  /** Set once the author has edited the text. */
  editedAt: string | null;
  /** Set once the message is deleted; it stays as a placeholder and `text` is "". */
  deletedAt: string | null;
  author: User;
}

export type RoomRole = "owner" | "member";

export interface RoomMember {
  user: User;
  role: RoomRole;
}

/**
 * Per-user, per-room receipt watermarks: every message in the room with
 * id <= deliveredUpTo reached the user's client, id <= readUpTo was seen by them.
 */
export interface Receipt {
  roomId: number;
  userId: number;
  deliveredUpTo: number;
  readUpTo: number;
}

/** A pending invite to a room, as members of that room see it. */
export interface RoomInvite {
  user: User;
  /** Null if the inviter's account was deleted. */
  invitedBy: User | null;
  createdAt: string;
}

/** A pending invite, as the invited user sees it (they can't see the room itself yet). */
export interface Invitation {
  roomId: number;
  roomName: string;
  invitedBy: User | null;
  memberCount: number;
  createdAt: string;
}

/** A room as seen by the current user. */
export interface Room {
  id: number;
  name: string;
  createdAt: string;
  members: RoomMember[];
  /** People invited who haven't accepted or declined yet. */
  invites: RoomInvite[];
  lastMessage: Message | null;
  /** Messages from others newer than the current user's read watermark (deleted ones excluded). */
  unreadCount: number;
  /** The current user's own watermarks in this room. */
  myReceipt: { deliveredUpTo: number; readUpTo: number };
}

/** Max messages returned by one GET /rooms/:id/messages. */
export const MESSAGES_PAGE_SIZE = 100;

/**
 * Query of GET /rooms/:id/messages. Without `after`: the latest page.
 * With `after`: the oldest page of messages with id > after (for catching up).
 */
export const messagesQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().optional(),
});
export type MessagesQuery = z.infer<typeof messagesQuerySchema>;

/** Messages ordered by id ascending, plus all receipts in the room. */
export interface MessagesResponse {
  messages: Message[];
  receipts: Receipt[];
}

export interface ApiError {
  error: string;
}

const messageId = z.number().int().nonnegative();
export const updateReceiptSchema = z
  .object({ deliveredUpTo: messageId.optional(), readUpTo: messageId.optional() })
  .refine((v) => v.deliveredUpTo !== undefined || v.readUpTo !== undefined, {
    message: "deliveredUpTo or readUpTo is required",
  });
export type UpdateReceiptInput = z.infer<typeof updateReceiptSchema>;

export const typingSchema = z.object({ typing: z.boolean() });
export type TypingInput = z.infer<typeof typingSchema>;

// ---- Realtime -------------------------------------------------------------

/** Presence channel with everyone currently connected; used for online status. */
export const ONLINE_CHANNEL = "presence-online";
/** Per-room channel; only members may subscribe. */
export const roomChannel = (roomId: number) => `private-room-${roomId}`;
/** Per-user channel for personal notifications (added to / removed from rooms). */
export const userChannel = (userId: number) => `private-user-${userId}`;

export const ROOM_CHANNEL_RE = /^private-room-(\d+)$/;
export const USER_CHANNEL_RE = /^private-user-(\d+)$/;

// room channel events
export const MESSAGE_CREATED_EVENT = "message:created";
export const MESSAGE_UPDATED_EVENT = "message:updated";
export const MESSAGE_DELETED_EVENT = "message:deleted";
export const USER_TYPING_EVENT = "user:typing";
export const RECEIPT_UPDATED_EVENT = "receipt:updated";
export const ROOM_MEMBERS_EVENT = "room:members";
export const ROOM_INVITES_EVENT = "room:invites";
// user channel events
export const ROOM_ADDED_EVENT = "room:added";
export const ROOM_REMOVED_EVENT = "room:removed";
export const INVITATION_ADDED_EVENT = "invitation:added";
export const INVITATION_REMOVED_EVENT = "invitation:removed";
// online channel events
export const USER_UPDATED_EVENT = "user:updated";

export interface TypingEvent {
  roomId: number;
  userId: number;
  typing: boolean;
}

/**
 * MESSAGE_UPDATED_EVENT and MESSAGE_DELETED_EVENT both carry the full `Message`
 * (for a deletion: with `deletedAt` set and empty `text`).
 */

export interface RoomMembersEvent {
  roomId: number;
  members: RoomMember[];
}

export interface RoomRemovedEvent {
  roomId: number;
}

export interface RoomInvitesEvent {
  roomId: number;
  invites: RoomInvite[];
}

/** INVITATION_ADDED_EVENT carries an `Invitation`; this one says it's gone (accepted, declined or cancelled). */
export interface InvitationRemovedEvent {
  roomId: number;
}

/** `user_info` attached to each presence member (user_id is the user's id as a string). */
export interface PresenceUserInfo {
  username: string;
  name: string | null;
}

/** Header carrying the Pusher socket id, so the server can skip echoing events back. */
export const SOCKET_ID_HEADER = "X-Socket-Id";

export interface RealtimeConfig {
  pusher: { key: string; cluster: string };
}
