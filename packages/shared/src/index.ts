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

const messageText = z.string().trim().max(2000, "Message is too long");

/**
 * Max size of one attachment. POST /rooms/:id/attachments takes the file as the raw body,
 * sent as application/octet-stream (so JSON and form files aren't parsed as request data),
 * with its real type and name in the headers below.
 */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENTS_PER_MESSAGE = 10;
/** Header carrying the attachment's file name, URI-encoded (headers are ASCII only). */
export const FILE_NAME_HEADER = "X-File-Name";
export const FILE_TYPE_HEADER = "X-File-Type";
/** Attachment types shown inline as pictures; anything else is offered as a download. */
export const INLINE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"] as const;
export const isInlineImage = (contentType: string) => (INLINE_IMAGE_TYPES as readonly string[]).includes(contentType);

/** Text, attachments uploaded beforehand (POST /rooms/:id/attachments), or both. */
export const createMessageSchema = z
  .object({
    text: messageText.default(""),
    attachmentIds: z
      .array(z.number().int().positive())
      .max(ATTACHMENTS_PER_MESSAGE, `At most ${ATTACHMENTS_PER_MESSAGE} attachments per message`)
      .default([]),
  })
  .refine((m) => m.text !== "" || m.attachmentIds.length > 0, { message: "Message is empty" });
export type CreateMessageInput = z.input<typeof createMessageSchema>;

/** The text may be emptied only if the message has attachments (checked by the server). */
export const updateMessageSchema = z.object({ text: messageText });
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
  /** Uploaded avatar (versioned, so it changes with every upload), or null for the default one. */
  avatarUrl: string | null;
}

/** Image types accepted by PUT /auth/me/avatar (sent as the raw request body). */
export const AVATAR_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AvatarContentType = (typeof AVATAR_CONTENT_TYPES)[number];
/** Max upload size; the client scales images down to `AVATAR_SIZE` px before uploading. */
export const AVATAR_MAX_BYTES = 1024 * 1024;
export const AVATAR_SIZE = 256;

/**
 * "text": a regular message written by `author`.
 * System lines, where `author` is who it's about and `text` is "":
 * "member_joined": accepted an invite; "member_left": left the room.
 */
export type MessageKind = "text" | "member_joined" | "member_left";

/** A file attached to a message. */
export interface Attachment {
  id: number;
  name: string;
  /** Bytes. */
  size: number;
  contentType: string;
  /** Members of the room can download it from here. */
  url: string;
}

export interface Message {
  id: number;
  roomId: number;
  kind: MessageKind;
  /** May be "" when the message has attachments. */
  text: string;
  /** Upload order; empty for system lines and deleted messages. */
  attachments: Attachment[];
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
  /** Latest message the current user can see (regular messages of people they blocked are skipped). */
  lastMessage: Message | null;
  /**
   * Messages from others newer than the current user's read watermark
   * (deleted and system ones, and those of blocked users, excluded).
   */
  unreadCount: number;
  /** The current user's own watermarks in this room. */
  myReceipt: { deliveredUpTo: number; readUpTo: number };
}

/** Max messages returned by one GET /rooms/:id/messages. */
export const MESSAGES_PAGE_SIZE = 20;

/**
 * Query of GET /rooms/:id/messages:
 * - neither: the latest page;
 * - `before`: the newest page of messages with id < before (scrolling back through history);
 * - `after`: the oldest page of messages with id > after (catching up after a disconnect).
 */
export const messagesQuerySchema = z
  .object({
    before: z.coerce.number().int().positive().optional(),
    after: z.coerce.number().int().nonnegative().optional(),
  })
  .refine((q) => q.before === undefined || q.after === undefined, {
    message: "Pass either before or after, not both",
  });
export type MessagesQuery = z.infer<typeof messagesQuerySchema>;

/** Messages ordered by id ascending, plus all receipts in the room. */
export interface MessagesResponse {
  messages: Message[];
  receipts: Receipt[];
  /**
   * Whether there are more messages past this page in the direction of the query:
   * older ones for the latest page and `before`, newer ones for `after`.
   */
  hasMore: boolean;
}

/** A demo account from `pnpm db:seed`, as listed on the public /seeds page. */
export interface SeedAccount {
  id: number;
  username: string;
  name: string | null;
  password: string;
  /** Rooms the account is a member of right now. */
  rooms: string[];
  /** What's worth looking at when logged in as this account. */
  note: string;
}

/** GET /api/seeds: demo accounts that exist and still have the demo password. */
export interface SeedsResponse {
  accounts: SeedAccount[];
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

export const blockSchema = z.object({ userId: z.number().int().positive() });
export type BlockInput = z.infer<typeof blockSchema>;

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
/** Carries `BlocksEvent`: the user's whole block list after a change (for their other tabs). */
export const BLOCKS_UPDATED_EVENT = "blocks:updated";
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

export interface BlocksEvent {
  blocked: User[];
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
  avatarUrl: string | null;
}

/** Header carrying the Pusher socket id, so the server can skip echoing events back. */
export const SOCKET_ID_HEADER = "X-Socket-Id";

export interface RealtimeConfig {
  pusher: { key: string; cluster: string };
}
