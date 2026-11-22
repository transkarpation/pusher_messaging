import {
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 32 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 64 }),
  /** When the current avatar was uploaded (null: no avatar); also versions its URL. */
  avatarUpdatedAt: timestamp("avatar_updated_at", { withTimezone: true }),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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

export const messageKind = pgEnum("message_kind", ["text", "member_joined", "member_left"]);

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
