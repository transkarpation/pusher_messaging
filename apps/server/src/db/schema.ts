import {
  type AnyPgColumn,
  boolean,
  customType,
  index,
  integer,
  smallint,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/** Account roles, lowest first (see `ROLES` in @pm/shared). */
export const userRole = pgEnum("user_role", ["user", "admin", "superadmin"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 32 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 64 }),
  /** When the current avatar was uploaded (null: no avatar); also versions its URL. */
  avatarUpdatedAt: timestamp("avatar_updated_at", { withTimezone: true }),
  role: userRole("role").notNull().default("user"),
  /** The admin who created the account on the administration page; null for sign-ups. */
  createdBy: integer("created_by").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

/** Avatar images, kept apart from `users` so user queries never load the bytes. */
export const userAvatars = pgTable("user_avatars", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  contentType: varchar("content_type", { length: 32 }).notNull(),
  data: bytea("data").notNull(),
});

export const sessions = pgTable(
  "sessions",
  {
    // sha256 of the token stored in the cookie
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

/** `blockerId` doesn't see messages from `blockedId` (the blocked user isn't told). */
export const userBlocks = pgTable(
  "user_blocks",
  {
    blockerId: integer("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: integer("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] })],
);

export const rooms = pgTable("rooms", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 64 }).notNull(),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  /** When the room's picture was set (null: none); also versions its URL. */
  avatarUpdatedAt: timestamp("avatar_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /**
   * Orders room lists (`Room.activity`): when the room's latest message was posted, or when the
   * room was created if it has none. Millisecond precision, so it round-trips through clients exactly.
   */
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
});

/** Room pictures, kept apart from `rooms` so room queries never load the bytes. */
export const roomAvatars = pgTable("room_avatars", {
  roomId: integer("room_id")
    .primaryKey()
    .references(() => rooms.id, { onDelete: "cascade" }),
  contentType: varchar("content_type", { length: 32 }).notNull(),
  data: bytea("data").notNull(),
});

export const roomRole = pgEnum("room_role", ["owner", "member"]);

export const roomMembers = pgTable(
  "room_members",
  {
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roomRole("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] }), index("room_members_user_id_idx").on(t.userId)],
);

export const roomInvites = pgTable(
  "room_invites",
  {
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    invitedBy: integer("invited_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] }), index("room_invites_user_id_idx").on(t.userId)],
);

export const messageKind = pgEnum("message_kind", [
  "text",
  "member_joined",
  "member_left",
  "poll",
  "room_renamed",
  "room_picture_changed",
  "room_picture_removed",
]);

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: messageKind("kind").notNull().default("text"),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("messages_room_id_id_idx").on(t.roomId, t.id)],
);

export const receipts = pgTable(
  "receipts",
  {
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deliveredUpTo: integer("delivered_up_to").notNull().default(0),
    readUpTo: integer("read_up_to").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] })],
);

/**
 * Files attached to messages. Uploaded first (`messageId` null, visible only to the
 * uploader), then linked when the message is sent; deleted with the message.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: serial("id").primaryKey(),
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    uploaderId: integer("uploader_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    messageId: integer("message_id").references(() => messages.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    contentType: varchar("content_type", { length: 127 }).notNull(),
    size: integer("size").notNull(),
    /** Audio recorded in the app: length and waveform, sent by the client with the upload. */
    durationMs: integer("duration_ms"),
    waveform: smallint("waveform").array(),
    /** The object key in the S3 bucket holding the bytes; null: they're in `attachment_data`. */
    storageKey: varchar("storage_key", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("attachments_message_id_idx").on(t.messageId),
    index("attachments_uploader_id_idx").on(t.uploaderId),
  ],
);

/** Attachment bytes stored in Postgres, kept apart so listing attachments never loads them. */
export const attachmentData = pgTable("attachment_data", {
  attachmentId: integer("attachment_id")
    .primaryKey()
    .references(() => attachments.id, { onDelete: "cascade" }),
  data: bytea("data").notNull(),
});

/**
 * A poll posted by a room owner, as a message of kind "poll" (one poll per message). Deleting
 * the message deletes this row, and with it the options, votes and comments.
 */
export const polls = pgTable("polls", {
  messageId: integer("message_id")
    .primaryKey()
    .references(() => messages.id, { onDelete: "cascade" }),
  question: varchar("question", { length: 300 }).notNull(),
  multiple: boolean("multiple").notNull().default(false),
  /** With `multiple`: at most this many options per person (null: any number). */
  maxVotes: smallint("max_votes"),
  anonymous: boolean("anonymous").notNull().default(false),
  allowSuggestions: boolean("allow_suggestions").notNull().default(false),
  allowComments: boolean("allow_comments").notNull().default(false),
  /** Bumped on every vote, new option or comment, so clients can tell a stale copy from a newer one. */
  version: integer("version").notNull().default(0),
});

export const pollOptions = pgTable(
  "poll_options",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id")
      .notNull()
      .references(() => polls.messageId, { onDelete: "cascade" }),
    text: varchar("text", { length: 100 }).notNull(),
    position: smallint("position").notNull(),
    /** Who added it: the poll's author, or a member suggesting it. */
    addedBy: integer("added_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("poll_options_message_id_idx").on(t.messageId)],
);

export const pollVotes = pgTable(
  "poll_votes",
  {
    optionId: integer("option_id")
      .notNull()
      .references(() => pollOptions.id, { onDelete: "cascade" }),
    messageId: integer("message_id")
      .notNull()
      .references(() => polls.messageId, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.optionId, t.userId] }), index("poll_votes_message_id_idx").on(t.messageId, t.userId)],
);

export const pollComments = pgTable(
  "poll_comments",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id")
      .notNull()
      .references(() => polls.messageId, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    text: varchar("text", { length: 500 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("poll_comments_message_id_idx").on(t.messageId)],
);
