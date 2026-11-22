import { z } from "zod";
import {
  AVATAR_CONTENT_TYPES,
  AVATAR_MAX_BYTES,
  MESSAGES_PAGE_SIZE,
  blockSchema,
  createMessageSchema,
  createRoomSchema,
  credentialsSchema,
  inviteSchema,
  typingSchema,
  updateMessageSchema,
  updateProfileSchema,
  updateReceiptSchema,
} from "@pm/shared";
import { SESSION_COOKIE } from "./session.js";

/**
 * OpenAPI 3.1 description of the HTTP API, served at /api/openapi.json and shown by
 * Swagger UI at /api/docs. Request bodies are generated from the same zod schemas that
 * validate them; response shapes mirror the interfaces in @pm/shared.
 */

type Schema = Record<string, unknown>;

/** JSON Schema of a zod request schema (what the client sends, so defaults are optional). */
const fromZod = (schema: z.ZodType): Schema => {
  const { $schema: _, ...json } = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Schema;
  return json;
};

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const nullable = (s: Schema): Schema => ({ oneOf: [s, { type: "null" }] });
const arrayOf = (s: Schema): Schema => ({ type: "array", items: s });
const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({
  type: "object",
  properties,
  required,
});
const isoDate = (description?: string): Schema => ({ type: "string", format: "date-time", ...(description && { description }) });

const json = (schema: Schema, description: string) => ({ description, content: { "application/json": { schema } } });
const jsonBody = (schema: Schema) => ({ required: true, content: { "application/json": { schema } } });
const error = (description: string) => json(ref("ApiError"), description);
const noContent = { description: "Done (no body)" };

const unauthorized = { 401: error("Not signed in") };
const badRequest = { 400: error("Invalid input; `error` says what's wrong") };
const roomNotFound = { 404: error("No such room, or you aren't a member of it (the same answer, so room ids don't leak)") };

const idParam = (name: string, description: string) => ({
  name,
  in: "path",
  required: true,
  description,
  schema: { type: "integer", minimum: 1 },
});
const roomId = idParam("roomId", "Room id");

const tags = {
  auth: "Auth & profile",
  users: "Users",
  rooms: "Rooms",
  messages: "Messages",
  invites: "Invitations",
  blocks: "Blocking",
  realtime: "Realtime",
  dev: "Development",
};

const schemas: Record<string, Schema> = {
  ApiError: object({ error: { type: "string", description: "Human-readable message" } }),
  User: object({
    id: { type: "integer" },
    username: { type: "string" },
    name: nullable({ type: "string" }),
    avatarUrl: {
      ...nullable({ type: "string" }),
      description: "Uploaded avatar (`/api/users/{id}/avatar?v=…`, changes with every upload), or null for the default one",
    },
  }),
  UserResponse: object({ user: ref("User") }),
  MessageKind: {
    type: "string",
    enum: ["text", "member_joined", "member_left"],
    description:
      "`text`: a regular message by `author`. System lines (`text` is \"\", `author` is who it's about): " +
      "`member_joined` accepted an invite, `member_left` left the room.",
  },
  Message: object({
    id: { type: "integer" },
    roomId: { type: "integer" },
    kind: ref("MessageKind"),
    text: { type: "string", description: "\"\" for system lines and deleted messages" },
    createdAt: isoDate(),
    editedAt: { ...nullable(isoDate()), description: "Set once the author edited the text" },
    deletedAt: { ...nullable(isoDate()), description: "Set once deleted; the message stays as a placeholder" },
    author: ref("User"),
  }),
  RoomRole: { type: "string", enum: ["owner", "member"] },
  RoomMember: object({ user: ref("User"), role: ref("RoomRole") }),
  RoomInvite: object({
    user: ref("User"),
    invitedBy: { ...nullable(ref("User")), description: "Null if the inviter's account was deleted" },
    createdAt: isoDate(),
  }),
  Receipt: {
    ...object({
      roomId: { type: "integer" },
      userId: { type: "integer" },
      deliveredUpTo: { type: "integer" },
      readUpTo: { type: "integer" },
    }),
    description:
      "Watermarks: every message in the room with id <= deliveredUpTo reached the user's client, id <= readUpTo was seen. They only move forward.",
  },
  Room: object({
    id: { type: "integer" },
    name: { type: "string" },
    createdAt: isoDate(),
    members: arrayOf(ref("RoomMember")),
    invites: { ...arrayOf(ref("RoomInvite")), description: "Pending invites" },
    lastMessage: {
      ...nullable(ref("Message")),
      description: "Latest message you can see (regular messages of people you blocked are skipped)",
    },
    unreadCount: {
      type: "integer",
      description: "Regular messages from others newer than your read watermark (not deleted, not from people you blocked)",
    },
    myReceipt: object({ deliveredUpTo: { type: "integer" }, readUpTo: { type: "integer" } }),
  }),
  Invitation: {
    ...object({
      roomId: { type: "integer" },
      roomName: { type: "string" },
      invitedBy: nullable(ref("User")),
      memberCount: { type: "integer" },
      createdAt: isoDate(),
    }),
    description: "A pending invite as the invited user sees it",
  },
  MessagesResponse: object({
    messages: { ...arrayOf(ref("Message")), description: "Ordered by id, oldest first" },
    receipts: { ...arrayOf(ref("Receipt")), description: "All receipts in the room" },
    hasMore: {
      type: "boolean",
      description: "More messages past this page: older ones for the latest page and `before`, newer ones for `after`",
    },
  }),
  BlocksResponse: object({ blocked: { ...arrayOf(ref("User")), description: "Most recently blocked first" } }),
  SeedAccount: object({
    id: { type: "integer" },
    username: { type: "string" },
    name: nullable({ type: "string" }),
    password: { type: "string" },
    rooms: { ...arrayOf({ type: "string" }), description: "Rooms the account is a member of" },
    note: { type: "string" },
  }),
  RealtimeConfig: object({ pusher: object({ key: { type: "string" }, cluster: { type: "string" } }) }),
};

const paths: Record<string, Record<string, Schema>> = {
  "/health": {
    get: {
      tags: [tags.dev],
      summary: "Health check",
      security: [],
      responses: { 200: json(object({ ok: { type: "boolean", const: true } }), "The server is up") },
    },
  },

  // ---- auth & profile ------------------------------------------------------
  "/auth/me": {
    get: {
      tags: [tags.auth],
      summary: "Current user",
      security: [],
      responses: { 200: json(object({ user: nullable(ref("User")) }), "`user` is null when not signed in") },
    },
    patch: {
      tags: [tags.auth],
      summary: "Change your display name",
      description: "Broadcasts `user:updated` on the presence channel.",
      requestBody: jsonBody(fromZod(updateProfileSchema)),
      responses: { 200: json(ref("UserResponse"), "Updated user"), ...badRequest, ...unauthorized },
    },
  },
  "/auth/register": {
    post: {
      tags: [tags.auth],
      summary: "Create an account and sign in",
      description: `Sets the \`${SESSION_COOKIE}\` session cookie. Usernames are stored lowercase.`,
      security: [],
      requestBody: jsonBody(fromZod(credentialsSchema)),
      responses: {
        201: json(ref("UserResponse"), "Signed in as the new user"),
        ...badRequest,
        409: error("Username is already taken"),
      },
    },
  },
  "/auth/login": {
    post: {
      tags: [tags.auth],
      summary: "Sign in",
      description: `Sets the \`${SESSION_COOKIE}\` session cookie; later requests from this page are then authenticated. Demo accounts: GET /seeds.`,
      security: [],
      requestBody: jsonBody(fromZod(credentialsSchema)),
      responses: { 200: json(ref("UserResponse"), "Signed in"), ...badRequest, 401: error("Invalid username or password") },
    },
  },
  "/auth/logout": {
    post: {
      tags: [tags.auth],
      summary: "Sign out",
      description: "Deletes the session and clears the cookie. Works signed out too.",
      security: [],
      responses: { 204: noContent },
    },
  },
  "/auth/me/avatar": {
    put: {
      tags: [tags.auth],
      summary: "Upload your avatar",
      description:
        `The image is the raw request body with its Content-Type (${AVATAR_CONTENT_TYPES.join(", ")}), up to ${AVATAR_MAX_BYTES / 1024} KB. ` +
        "The type is checked against the file's bytes. The web client crops and scales to 256×256 first. Broadcasts `user:updated`.",
      requestBody: {
        required: true,
        content: Object.fromEntries(
          AVATAR_CONTENT_TYPES.map((t) => [t, { schema: { type: "string", contentMediaType: t } }]),
        ),
      },
      responses: {
        200: json(ref("UserResponse"), "User with the new `avatarUrl`"),
        400: error("Not a PNG, JPEG or WebP image"),
        ...unauthorized,
        413: error("Image is too large"),
      },
    },
    delete: {
      tags: [tags.auth],
      summary: "Remove your avatar",
      description: "Back to the default avatar (a colored circle with the initial). Broadcasts `user:updated`.",
      responses: { 200: json(ref("UserResponse"), "User with `avatarUrl: null`"), ...unauthorized },
    },
  },

  // ---- users ---------------------------------------------------------------
  "/users": {
    get: {
      tags: [tags.users],
      summary: "Search other users",
      description: "By username or name, case-insensitive; you are excluded. At most 20, ordered by username.",
      parameters: [{ name: "q", in: "query", description: "Search text (empty: anyone)", schema: { type: "string", maxLength: 64 } }],
      responses: { 200: json(arrayOf(ref("User")), "Matching users"), ...unauthorized },
    },
  },
  "/users/{id}/avatar": {
    get: {
      tags: [tags.users],
      summary: "A user's avatar image",
      description: "Use the versioned `User.avatarUrl`: responses are cached for a year.",
      parameters: [idParam("id", "User id")],
      responses: {
        200: {
          description: "The image",
          content: Object.fromEntries(AVATAR_CONTENT_TYPES.map((t) => [t, { schema: { type: "string", contentMediaType: t } }])),
        },
        ...unauthorized,
        404: error("The user has no avatar"),
      },
    },
  },

  // ---- rooms ---------------------------------------------------------------
  "/rooms": {
    get: {
      tags: [tags.rooms],
      summary: "Your rooms",
      responses: { 200: json(arrayOf(ref("Room")), "Rooms you're a member of"), ...unauthorized },
    },
    post: {
      tags: [tags.rooms],
      summary: "Create a room",
      description: "You become its owner. `inviteIds` are invited (unknown ids and yourself are skipped); they join once they accept.",
      requestBody: jsonBody(fromZod(createRoomSchema)),
      responses: { 201: json(ref("Room"), "The new room"), ...badRequest, ...unauthorized },
    },
  },
  "/rooms/{roomId}": {
    get: {
      tags: [tags.rooms],
      summary: "One room",
      parameters: [roomId],
      responses: { 200: json(ref("Room"), "The room"), ...unauthorized, ...roomNotFound },
    },
  },
  "/rooms/{roomId}/invites": {
    post: {
      tags: [tags.rooms],
      summary: "Invite people",
      description: "Any member may invite. Current members and people already invited are skipped.",
      parameters: [roomId],
      requestBody: jsonBody(fromZod(inviteSchema)),
      responses: {
        200: json(object({ invites: arrayOf(ref("RoomInvite")) }), "All pending invites of the room"),
        ...badRequest,
        ...unauthorized,
        ...roomNotFound,
      },
    },
  },
  "/rooms/{roomId}/invites/{userId}": {
    delete: {
      tags: [tags.rooms],
      summary: "Cancel an invite",
      description: "Allowed for the room owner and for whoever sent the invite.",
      parameters: [roomId, idParam("userId", "The invited user")],
      responses: {
        200: json(object({ invites: arrayOf(ref("RoomInvite")) }), "Remaining pending invites"),
        ...unauthorized,
        403: error("Only the owner or the inviter can cancel an invite"),
        404: error("Room or invite not found"),
      },
    },
  },
  "/rooms/{roomId}/members/{userId}": {
    delete: {
      tags: [tags.rooms],
      summary: "Remove a member, or leave",
      description:
        "With your own id: leave the room (not allowed for the owner; posts a `member_left` line). " +
        "With someone else's: only the owner may remove them.",
      parameters: [roomId, idParam("userId", "Member to remove (your own id to leave)")],
      responses: {
        200: json(object({ members: arrayOf(ref("RoomMember")) }), "Remaining members"),
        400: error("The owner can't leave the room"),
        ...unauthorized,
        403: error("Only the owner can remove members"),
        404: error("Room not found, or that user isn't a member"),
      },
    },
  },
  "/rooms/{roomId}/typing": {
    post: {
      tags: [tags.rooms],
      summary: "Report typing",
      description: "Relayed to the other members as `user:typing`. Clients repeat `typing: true` while typing; it expires after a few seconds.",
      parameters: [roomId],
      requestBody: jsonBody(fromZod(typingSchema)),
      responses: { 204: noContent, ...badRequest, ...unauthorized, ...roomNotFound },
    },
  },

  // ---- messages ------------------------------------------------------------
  "/rooms/{roomId}/messages": {
    get: {
      tags: [tags.messages],
      summary: "A page of messages",
      description:
        `Up to ${MESSAGES_PAGE_SIZE} messages, plus the room's receipts.\n\n` +
        "- no parameters: the latest page;\n" +
        "- `before`: the page just older than that id (scrolling back; repeat with the oldest id while `hasMore`);\n" +
        "- `after`: the oldest page newer than that id (catching up after a disconnect).",
      parameters: [
        roomId,
        { name: "before", in: "query", description: "Load messages with id < before", schema: { type: "integer", minimum: 1 } },
        { name: "after", in: "query", description: "Load messages with id > after (not together with `before`)", schema: { type: "integer", minimum: 0 } },
      ],
      responses: { 200: json(ref("MessagesResponse"), "The page"), ...badRequest, ...unauthorized, ...roomNotFound },
    },
    post: {
      tags: [tags.messages],
      summary: "Send a message",
      description: "Broadcast to the room as `message:created` (not echoed to the sender's socket if `X-Socket-Id` is sent).",
      parameters: [roomId],
      requestBody: jsonBody(fromZod(createMessageSchema)),
      responses: { 201: json(ref("Message"), "The new message"), ...badRequest, ...unauthorized, ...roomNotFound },
    },
  },
  "/rooms/{roomId}/messages/{messageId}": {
    patch: {
      tags: [tags.messages],
      summary: "Edit your message",
      description: "Only the author, only regular messages that aren't deleted. Broadcast as `message:updated`.",
      parameters: [roomId, idParam("messageId", "Message id")],
      requestBody: jsonBody(fromZod(updateMessageSchema)),
      responses: {
        200: json(ref("Message"), "The edited message (`editedAt` set)"),
        ...badRequest,
        ...unauthorized,
        403: error("You can only edit your own messages"),
        404: error("Room or message not found (or it's deleted or a system line)"),
      },
    },
    delete: {
      tags: [tags.messages],
      summary: "Delete a message",
      description: "The author, or the room owner for anyone's. It stays as a placeholder (`deletedAt` set, `text` \"\"). Broadcast as `message:deleted`.",
      parameters: [roomId, idParam("messageId", "Message id")],
      responses: {
        200: json(ref("Message"), "The deleted message"),
        400: error("Invalid message id"),
        ...unauthorized,
        403: error("You can only delete your own messages"),
        404: error("Room or message not found (or it's already deleted or a system line)"),
      },
    },
  },
  "/rooms/{roomId}/receipts": {
    post: {
      tags: [tags.messages],
      summary: "Move your delivered/read watermarks",
      description: "Watermarks never move back; lower values are ignored. Broadcast as `receipt:updated`.",
      parameters: [roomId],
      requestBody: jsonBody(fromZod(updateReceiptSchema)),
      responses: { 200: json(ref("Receipt"), "Your receipt after the update"), ...badRequest, ...unauthorized, ...roomNotFound },
    },
  },

  // ---- invitations ---------------------------------------------------------
  "/invites": {
    get: {
      tags: [tags.invites],
      summary: "Invitations to you",
      responses: { 200: json(arrayOf(ref("Invitation")), "Pending invitations, newest first"), ...unauthorized },
    },
  },
  "/invites/{roomId}/accept": {
    post: {
      tags: [tags.invites],
      summary: "Accept an invitation",
      description: "You join the room; a `member_joined` line is posted.",
      parameters: [roomId],
      responses: { 200: json(ref("Room"), "The room you joined"), ...unauthorized, 404: error("Invitation not found") },
    },
  },
  "/invites/{roomId}/decline": {
    post: {
      tags: [tags.invites],
      summary: "Decline an invitation",
      parameters: [roomId],
      responses: { 204: noContent, ...unauthorized, 404: error("Invitation not found") },
    },
  },

  // ---- blocking ------------------------------------------------------------
  "/blocks": {
    get: {
      tags: [tags.blocks],
      summary: "People you blocked",
      responses: { 200: json(ref("BlocksResponse"), "Your block list"), ...unauthorized },
    },
    post: {
      tags: [tags.blocks],
      summary: "Block someone",
      description:
        "Their regular messages are left out of your room previews and unread counts (the web client also hides them). " +
        "They aren't told. Blocking again is a no-op. Your other tabs get `blocks:updated`.",
      requestBody: jsonBody(fromZod(blockSchema)),
      responses: {
        200: json(ref("BlocksResponse"), "Your block list after the change"),
        400: error("Invalid input, or blocking yourself"),
        ...unauthorized,
        404: error("User not found"),
      },
    },
  },
  "/blocks/{userId}": {
    delete: {
      tags: [tags.blocks],
      summary: "Unblock someone",
      parameters: [idParam("userId", "User to unblock")],
      responses: { 200: json(ref("BlocksResponse"), "Your block list after the change"), 400: error("Invalid user id"), ...unauthorized },
    },
  },

  // ---- realtime ------------------------------------------------------------
  "/realtime/config": {
    get: {
      tags: [tags.realtime],
      summary: "Pusher client config",
      security: [],
      responses: { 200: json(ref("RealtimeConfig"), "Public Pusher key and cluster") },
    },
  },
  "/realtime/pusher/auth": {
    post: {
      tags: [tags.realtime],
      summary: "Authorize a Pusher channel subscription",
      description:
        "Called by pusher-js. `presence-online`: anyone signed in; `private-user-{id}`: only that user; `private-room-{id}`: only room members.",
      requestBody: {
        required: true,
        content: {
          "application/x-www-form-urlencoded": {
            schema: object({ socket_id: { type: "string" }, channel_name: { type: "string" } }),
          },
        },
      },
      responses: {
        200: json(
          object({ auth: { type: "string" }, channel_data: { type: "string" } }, ["auth"]),
          "Pusher auth signature (`channel_data` for the presence channel)",
        ),
        400: error("socket_id and channel_name are required"),
        ...unauthorized,
        403: error("Forbidden channel"),
      },
    },
  },

  // ---- development ---------------------------------------------------------
  "/seeds": {
    get: {
      tags: [tags.dev],
      summary: "Demo accounts with passwords",
      description:
        "Accounts created by `pnpm db:seed` that still have the demo password. No login needed. Not served when NODE_ENV=production.",
      security: [],
      responses: {
        200: json(object({ accounts: arrayOf(ref("SeedAccount")) }), "Demo accounts"),
        404: error("Running in production"),
      },
    },
  },
};

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "pusher-messaging API",
    version: "1.0.0",
    description:
      "HTTP API of the chat. Authentication is a session cookie: call **POST /auth/login** (or /auth/register) " +
      "here first and the browser sends the cookie with every later request. Real-time events go through Pusher; " +
      "send the `X-Socket-Id` header to keep your own connection from receiving the event your request caused.",
  },
  servers: [{ url: "/api" }],
  tags: Object.values(tags).map((name) => ({ name })),
  security: [{ sessionCookie: [] }],
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: SESSION_COOKIE, description: "Set by POST /auth/login" },
    },
    schemas,
  },
  paths,
};
