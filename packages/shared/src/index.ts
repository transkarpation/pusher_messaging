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

/**
 * Body of POST /auth/login and /auth/register. `session` picks how the session is kept:
 * "cookie" (the default, for the web client) sets an httpOnly cookie; "token" (for mobile
 * and other non-browser clients) returns the token instead, to send as `Authorization: Bearer <token>`.
 */
export const authRequestSchema = credentialsSchema.extend({
  session: z.enum(["cookie", "token"]).default("cookie"),
});
export type AuthRequest = z.input<typeof authRequestSchema>;

/** Response of login/register with `session: "token"`. */
export interface TokenAuthResponse {
  user: SessionUser;
  token: string;
  /** ISO date; sign in again after it. */
  expiresAt: string;
}

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
/** Optional, for audio: its length in ms, and its waveform as comma-separated levels (see `WAVEFORM_BARS`). */
export const AUDIO_DURATION_HEADER = "X-Audio-Duration";
export const AUDIO_WAVEFORM_HEADER = "X-Audio-Waveform";
/** A voice message's waveform: this many bars, each 0–`WAVEFORM_MAX`, the loudest at the max. */
export const WAVEFORM_BARS = 40;
export const WAVEFORM_MAX = 100;
/** Attachment types shown inline as pictures. */
export const INLINE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"] as const;
export const isInlineImage = (contentType: string) => (INLINE_IMAGE_TYPES as readonly string[]).includes(contentType);
/** Attachment types played inline (voice messages and other audio). */
export const INLINE_AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/aac", "audio/wav"] as const;
export const isInlineAudio = (contentType: string) => (INLINE_AUDIO_TYPES as readonly string[]).includes(contentType);
/** Whether the server serves an attachment with its own type; anything else is only offered as a download. */
export const isInlineMedia = (contentType: string) => isInlineImage(contentType) || isInlineAudio(contentType);
/** Name given to recorded voice messages (plus an extension for the format). */
export const VOICE_MESSAGE_NAME = "Voice message";
/** Audio recorded in the app (it comes with a waveform), as opposed to an uploaded audio file. */
export const isVoiceRecording = (a: { contentType: string; waveform: number[] | null }) =>
  isInlineAudio(a.contentType) && a.waveform !== null;
/** A voice message can't be edited, only deleted. */
export const isVoiceMessage = (m: { attachments: { contentType: string; waveform: number[] | null }[] }) =>
  m.attachments.some(isVoiceRecording);

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

/** Image types accepted for avatars: PUT /auth/me/avatar (the raw request body) and a new room's `avatar`. */
export const AVATAR_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AvatarContentType = (typeof AVATAR_CONTENT_TYPES)[number];
/** Max upload size; the client scales images down to `AVATAR_SIZE` px before uploading. */
export const AVATAR_MAX_BYTES = 1024 * 1024;
export const AVATAR_SIZE = 256;

const roomName = z.string().trim().min(1, "Room name is required").max(64, "Room name is too long");
const avatarBase64 = z
  .string()
  .min(1, "The picture is empty")
  .max(Math.ceil(AVATAR_MAX_BYTES / 3) * 4, "The picture is too large")
  .regex(/^[A-Za-z0-9+/]*={0,2}$/, "The picture must be base64-encoded");

export const createRoomSchema = z.object({
  name: roomName,
  /** People to invite; they join once they accept. */
  inviteIds: userIds.default([]),
  /** The room's picture: a PNG, JPEG or WebP image (up to `AVATAR_MAX_BYTES`), base64-encoded. */
  avatar: avatarBase64.optional(),
});
export type CreateRoomInput = z.input<typeof createRoomSchema>;

/** The owner's changes to a room; fields left out stay as they are. */
export const updateRoomSchema = z
  .object({
    name: roomName.optional(),
    /** A new picture (as in `createRoomSchema`), or null to remove it. */
    avatar: avatarBase64.nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.avatar !== undefined, "Nothing to change");
export type UpdateRoomInput = z.input<typeof updateRoomSchema>;

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

// ---- Roles & administration -------------------------------------------------

/**
 * Account roles, lowest first. Each role manages only the roles below it: a superadmin
 * creates and edits admins and users, an admin creates and edits users.
 */
export const ROLES = ["user", "admin", "superadmin"] as const;
export type Role = (typeof ROLES)[number];

const roleRank = (role: Role) => ROLES.indexOf(role);

/** Roles that `role` may assign, view and edit (everything strictly below it). */
export const manageableRoles = (role: Role): Role[] => ROLES.slice(0, roleRank(role));

/** Whether `actor` may view, edit or create an account with role `target`. */
export const canManageRole = (actor: Role, target: Role) => roleRank(target) < roleRank(actor);

/** Whether `role` opens the administration page. */
export const isAdminRole = (role: Role) => manageableRoles(role).length > 0;

/**
 * The signed-in user as the auth endpoints return it: the public profile plus the role.
 * Roles aren't part of `User`, so other people's roles never reach clients.
 */
export interface SessionUser extends User {
  role: Role;
}

/** Response of GET /auth/me. */
export interface MeResponse {
  user: SessionUser | null;
}

/** An account as the administration page lists it. */
export interface AdminUser extends User {
  role: Role;
  createdAt: string;
  /** Who created the account from the administration page; null for sign-ups (or a deleted creator). */
  createdBy: User | null;
}

const roleSchema = z.enum(ROLES);

/** Columns the administration list can be sorted by. `role` sorts by rank (user < admin < superadmin). */
export const ADMIN_USER_SORT_FIELDS = ["username", "name", "role", "createdAt"] as const;
export type AdminUserSortField = (typeof ADMIN_USER_SORT_FIELDS)[number];
export const ADMIN_PAGE_SIZES = [10, 25, 50, 100] as const;
export const ADMIN_DEFAULT_PAGE_SIZE = 25;

/** Query of GET /admin/users. Ties are broken by username, so pages don't overlap. */
export const adminUsersQuerySchema = z.object({
  /** Username or name contains this (case-insensitive); empty: anyone. */
  q: z.string().trim().max(64, "Search text is too long").default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(ADMIN_DEFAULT_PAGE_SIZE),
  sort: z.enum(ADMIN_USER_SORT_FIELDS).default("username"),
  order: z.enum(["asc", "desc"]).default("asc"),
});
export type AdminUsersQuery = z.input<typeof adminUsersQuerySchema>;

/** Response of GET /admin/users: one page of accounts. */
export interface AdminUsersPage {
  users: AdminUser[];
  /** Accounts matching the search, on all pages. */
  total: number;
  page: number;
  pageSize: number;
}

/** Body of POST /admin/users. The role must be below the caller's. */
export const createAdminUserSchema = credentialsSchema.extend({
  name: updateProfileSchema.shape.name.optional(),
  role: roleSchema.default("user"),
});
export type CreateAdminUserInput = z.input<typeof createAdminUserSchema>;

/** Body of PATCH /admin/users/:id; fields left out stay as they are. A new password signs the account out everywhere. */
export const updateAdminUserSchema = z
  .object({
    name: z.string().trim().max(64, "Name is too long").nullable().optional(),
    role: roleSchema.optional(),
    password: credentialsSchema.shape.password.optional(),
  })
  .refine((v) => v.name !== undefined || v.role !== undefined || v.password !== undefined, "Nothing to change");
export type UpdateAdminUserInput = z.input<typeof updateAdminUserSchema>;

/**
 * "text": a regular message written by `author`.
 * "poll": a poll posted by `author` (the room owner), in `Message.poll`; `text` is "".
 * System lines, where `author` is who it's about (or who did it) and `text` is "" unless noted:
 * "member_joined": accepted an invite; "member_left": left the room;
 * "room_renamed": the owner renamed the room, `text` is the new name;
 * "room_picture_changed" / "room_picture_removed": the owner set or removed the room's picture.
 */
export type MessageKind =
  | "text"
  | "poll"
  | "member_joined"
  | "member_left"
  | "room_renamed"
  | "room_picture_changed"
  | "room_picture_removed";

export const SYSTEM_MESSAGE_KINDS = [
  "member_joined",
  "member_left",
  "room_renamed",
  "room_picture_changed",
  "room_picture_removed",
] as const satisfies readonly MessageKind[];

/** "Bob joined the room" and the like, as opposed to messages someone wrote (text and polls). */
export const isSystemMessage = (m: { kind: MessageKind }) => (SYSTEM_MESSAGE_KINDS as readonly MessageKind[]).includes(m.kind);

/** A system line's text, with `who` the display name of its author ("You" for oneself); null for other messages. */
export function systemMessageText(m: { kind: MessageKind; text: string }, who: string): string | null {
  switch (m.kind) {
    case "member_joined":
      return `${who} joined the room`;
    case "member_left":
      return `${who} left the room`;
    case "room_renamed":
      return `${who} renamed the room to «${m.text}»`;
    case "room_picture_changed":
      return `${who} changed the room picture`;
    case "room_picture_removed":
      return `${who} removed the room picture`;
    case "text":
    case "poll":
      return null;
  }
}

/** A file attached to a message. */
export interface Attachment {
  id: number;
  name: string;
  /** Bytes. */
  size: number;
  contentType: string;
  /** Members of the room can download it from here. */
  url: string;
  /** Audio recorded in the app (voice messages): length in ms, or null if unknown. */
  durationMs: number | null;
  /** Audio recorded in the app: `WAVEFORM_BARS` levels, each 0–`WAVEFORM_MAX`; null otherwise. */
  waveform: number[] | null;
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
  /** The poll of a "poll" message; null for other kinds and once the poll is deleted. */
  poll: Poll | null;
}

// ---- Polls ----------------------------------------------------------------

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 12;
/** Bounds of `maxVotes`, the optional per-person limit of a multiple-choice poll. */
export const POLL_VOTE_LIMIT_MIN = 2;
export const POLL_VOTE_LIMIT_MAX = 10;

const pollOptionText = z.string().trim().min(1, "Options can't be empty").max(100, "An option is too long");
const sameText = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** Body of POST /rooms/:id/polls (room owner only). */
export const createPollSchema = z
  .object({
    question: z.string().trim().min(1, "Question is required").max(300, "Question is too long"),
    options: z
      .array(pollOptionText)
      .min(POLL_MIN_OPTIONS, `Add at least ${POLL_MIN_OPTIONS} options`)
      .max(POLL_MAX_OPTIONS, `At most ${POLL_MAX_OPTIONS} options`),
    /** Voters may pick more than one option. */
    multiple: z.boolean().default(false),
    /** With `multiple`: at most this many options per person; null for no limit. */
    maxVotes: z.number().int().min(POLL_VOTE_LIMIT_MIN).max(POLL_VOTE_LIMIT_MAX).nullable().default(null),
    /** Nobody, the author included, sees who voted for what. */
    anonymous: z.boolean().default(false),
    /** Members may add options of their own. */
    allowSuggestions: z.boolean().default(false),
    /** Members may comment on the poll. */
    allowComments: z.boolean().default(false),
  })
  .refine((p) => p.options.every((o, i) => p.options.findIndex((x) => sameText(x, o)) === i), {
    message: "Options must be different",
  })
  .refine((p) => p.maxVotes === null || p.multiple, { message: "A vote limit needs multiple votes" });
export type CreatePollInput = z.input<typeof createPollSchema>;

/** Body of PUT /rooms/:id/polls/:messageId/votes: the caller's whole choice; [] takes the vote back. */
export const pollVoteSchema = z.object({
  optionIds: z.array(z.number().int().positive()).max(POLL_MAX_OPTIONS, "Too many options"),
});
export type PollVoteInput = z.infer<typeof pollVoteSchema>;

/** Body of POST /rooms/:id/polls/:messageId/options. */
export const pollOptionSchema = z.object({ text: pollOptionText });
export type PollOptionInput = z.infer<typeof pollOptionSchema>;

/** Body of POST /rooms/:id/polls/:messageId/comments. */
export const pollCommentSchema = z.object({
  text: z.string().trim().min(1, "Comment is empty").max(500, "Comment is too long"),
});
export type PollCommentInput = z.infer<typeof pollCommentSchema>;

export interface PollOption {
  id: number;
  text: string;
  voteCount: number;
  /** Who voted for it, earliest first; always empty in an anonymous poll. */
  voters: User[];
  /** Who added it (the author, or a member suggesting it); null if that account is gone. */
  addedBy: User | null;
}

export interface PollComment {
  id: number;
  author: User;
  text: string;
  createdAt: string;
}

/** A poll as everyone in the room sees it (what POLL_UPDATED_EVENT carries). */
export interface PollState {
  question: string;
  multiple: boolean;
  maxVotes: number | null;
  anonymous: boolean;
  allowSuggestions: boolean;
  allowComments: boolean;
  /** In the order the author gave, suggestions after them. */
  options: PollOption[];
  /** People who voted (for any number of options); percentages are of this. */
  voterCount: number;
  /** Oldest first. */
  comments: PollComment[];
  /** Grows with every change; of two copies of a poll, the higher version is newer. */
  version: number;
}

/** A poll as the current user sees it. */
export interface Poll extends PollState {
  /** Options the current user voted for; empty if they haven't voted. */
  myVotes: number[];
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

/** Where a saved message got to: saved on the server, delivered to someone's device, or read by someone. */
export type ReceiptStatus = "sent" | "delivered" | "read";

export interface MessageDelivery {
  status: ReceiptStatus;
  deliveredCount: number;
  readCount: number;
}

/** Status of a saved message, from the room's receipts (by user id), counted over everyone except its author. */
export function deliveryOf(message: { id: number; author: { id: number } }, receipts: Record<number, Receipt>): MessageDelivery {
  let deliveredCount = 0;
  let readCount = 0;
  for (const r of Object.values(receipts)) {
    if (r.userId === message.author.id) continue;
    if (r.deliveredUpTo >= message.id) deliveredCount++;
    if (r.readUpTo >= message.id) readCount++;
  }
  const status: ReceiptStatus = readCount > 0 ? "read" : deliveredCount > 0 ? "delivered" : "sent";
  return { status, deliveredCount, readCount };
}

/** Merges two receipts of the same user: watermarks only move forward. */
export const mergeReceipt = (prev: Receipt | undefined, next: Receipt): Receipt =>
  prev
    ? { ...next, deliveredUpTo: Math.max(prev.deliveredUpTo, next.deliveredUpTo), readUpTo: Math.max(prev.readUpTo, next.readUpTo) }
    : next;

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
  /** The room's picture (see `Room.avatarUrl`), or null. */
  roomAvatarUrl: string | null;
  invitedBy: User | null;
  memberCount: number;
  createdAt: string;
}

/** A room as seen by the current user. */
export interface Room {
  id: number;
  name: string;
  /**
   * The picture chosen when the room was created (`/api/rooms/{id}/avatar?v=…`), or null for
   * the default one. Served to members and to people invited to the room.
   */
  avatarUrl: string | null;
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
  /**
   * When the room was last active, in epoch milliseconds, for ordering the room list (higher:
   * more recent): the time of its latest message (anyone's, system lines included), or of its
   * creation if it has none. A new message `m` raises it to `Date.parse(m.createdAt)`. Ties are
   * broken by room id, higher first.
   */
  activity: number;
}

/** Rooms per page of GET /rooms when `limit` isn't given. */
export const ROOMS_PAGE_SIZE = 10;
/** Largest `limit` GET /rooms accepts. */
export const ROOMS_MAX_PAGE_SIZE = 100;

/** The cursor that continues a room list after `room` (see `RoomsPage.nextCursor`). */
export const roomsCursor = (room: Pick<Room, "id" | "activity">) => `${room.activity}.${room.id}`;

/**
 * Query of GET /rooms: the user's rooms, most recently active first (`Room.activity`, then id).
 * - `limit`: rooms per page (ROOMS_PAGE_SIZE by default, at most ROOMS_MAX_PAGE_SIZE);
 * - `before`: a `nextCursor` from the previous page, for the rooms after it.
 */
export const roomsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(ROOMS_MAX_PAGE_SIZE).default(ROOMS_PAGE_SIZE),
  before: z
    .string()
    .regex(/^\d+\.\d+$/, "Invalid cursor")
    .transform((v) => {
      const [activity, id] = v.split(".").map(Number) as [number, number];
      return { activity, id };
    })
    .optional(),
});
export type RoomsQuery = z.input<typeof roomsQuerySchema>;

export interface RoomsPage {
  rooms: Room[];
  /** Pass as `before` for the next page; null when this was the last one. */
  nextCursor: string | null;
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
  role: Role;
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

/**
 * Internal topic on the realtime server, not a channel clients join: each user channel listens
 * to the topics of the user's rooms and forwards their ROOM_ACTIVITY_EVENT. The API publishes
 * one event per message here instead of one per member.
 */
export const roomActivityTopic = (roomId: number) => `room-activity:${roomId}`;

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
/** Carries `RoomUpdatedEvent`: the owner renamed the room or changed its picture. */
export const ROOM_UPDATED_EVENT = "room:updated";
/** Carries `PollUpdatedEvent`: a poll got a vote, an option or a comment. */
export const POLL_UPDATED_EVENT = "poll:updated";
// user channel events
/**
 * Carries `RoomActivityEvent`: a new message in one of the user's rooms. Sent for every room
 * the user belongs to, whether or not the client has it loaded or subscribed to its channel,
 * so the room list can move it up (and fetch it, if it wasn't loaded).
 */
export const ROOM_ACTIVITY_EVENT = "room:activity";
export const ROOM_ADDED_EVENT = "room:added";
export const ROOM_REMOVED_EVENT = "room:removed";
export const INVITATION_ADDED_EVENT = "invitation:added";
export const INVITATION_REMOVED_EVENT = "invitation:removed";
/** Carries `BlocksEvent`: the user's whole block list after a change (for their other tabs). */
export const BLOCKS_UPDATED_EVENT = "blocks:updated";
/** Carries `PollVotedEvent`: the user's own vote changed (for their other tabs). */
export const POLL_VOTED_EVENT = "poll:voted";
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

/** A new message in a room; the room's `activity` is now the message's time. */
export interface RoomActivityEvent {
  roomId: number;
  message: Message;
}

export interface RoomRemovedEvent {
  roomId: number;
}

/** The owner changed the room's name or picture. */
export interface RoomUpdatedEvent {
  roomId: number;
  name: string;
  avatarUrl: string | null;
}

export interface BlocksEvent {
  blocked: User[];
}

export interface RoomInvitesEvent {
  roomId: number;
  invites: RoomInvite[];
}

export interface PollUpdatedEvent {
  roomId: number;
  messageId: number;
  poll: PollState;
}

export interface PollVotedEvent {
  roomId: number;
  messageId: number;
  myVotes: number[];
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

/** Header carrying the realtime socket id, so the server can skip echoing events back. */
export const SOCKET_ID_HEADER = "X-Socket-Id";

/**
 * `avatarUrl`, `Attachment.url` and other links in API responses are paths on the API
 * server ("/api/…"). The web client uses them as they are (same origin); other clients
 * resolve them against the server's address, e.g. resolveApiUrl("https://chat.example.com", url).
 */
export const resolveApiUrl = (serverOrigin: string, path: string) => new URL(path, serverOrigin).toString();

// ---- Realtime connection --------------------------------------------------

/**
 * Where clients connect for realtime events, served by GET /api/realtime/config: the
 * phoenix.js endpoint of apps/realtime-server-phoenix (PHOENIX_SOCKET_URL on the server).
 */
export interface RealtimeConfig {
  socketUrl: string;
}

/** Endpoint that issues the token a client connects to the Phoenix server with. */
export const PHOENIX_TOKEN_PATH = "/api/realtime/phoenix/token";

export interface PhoenixTokenResponse {
  /** Pass as the `token` connect param. */
  token: string;
  expiresAt: string;
}

/** A user on a presence channel. `id` is the user's id as a string. */
export interface PresenceMember {
  id: string;
  info: PresenceUserInfo;
}
