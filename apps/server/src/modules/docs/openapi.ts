import { z } from "zod";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENTS_PER_MESSAGE,
  WAVEFORM_BARS,
  WAVEFORM_MAX,
  AVATAR_CONTENT_TYPES,
  AVATAR_MAX_BYTES,
  MESSAGES_PAGE_SIZE,
  POLL_MAX_OPTIONS,
  blockSchema,
  createMessageSchema,
  createPollSchema,
  createRoomSchema,
  updateRoomSchema,
  ROLES,
  SYSTEM_MESSAGE_KINDS,
  createAdminUserSchema,
  ADMIN_DEFAULT_PAGE_SIZE,
  ADMIN_USER_SORT_FIELDS,
  updateAdminUserSchema,
  authRequestSchema,
  inviteSchema,
  pollCommentSchema,
  pollOptionSchema,
  pollVoteSchema,
  typingSchema,
  updateMessageSchema,
  updateProfileSchema,
  updateReceiptSchema,
} from "@pm/shared";
import { SESSION_COOKIE } from "../auth/index.js";

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
  admin: "Administration",
  rooms: "Rooms",
  messages: "Messages",
  polls: "Polls",
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
  Role: {
    type: "string",
    enum: [...ROLES],
    description: "Lowest first. A superadmin manages admins and users, an admin manages users.",
  },
  SessionUser: {
    allOf: [ref("User"), object({ role: ref("Role") })],
    description: "The signed-in user: the profile plus the role (other people's roles aren't shown)",
  },
  UserResponse: object({ user: ref("SessionUser") }),
  AdminUser: {
    allOf: [
      ref("User"),
      object({
        role: ref("Role"),
        createdAt: isoDate(),
        createdBy: { ...nullable(ref("User")), description: "Who created it on the administration page; null for sign-ups" },
      }),
    ],
  },
  TokenAuthResponse: object({
    user: ref("SessionUser"),
    token: { type: "string", description: "Send as `Authorization: Bearer <token>`" },
    expiresAt: isoDate("Sign in again after this"),
  }),
  MessageKind: {
    type: "string",
    enum: ["text", "poll", ...SYSTEM_MESSAGE_KINDS],
    description:
      "`text`: a regular message by `author`. `poll`: a poll by `author` (the room owner) in `poll`, `text` is \"\". " +
      "System lines (`text` is \"\" unless noted, `author` is who it's about or who did it): " +
      "`member_joined` accepted an invite, `member_left` left the room, `room_renamed` the owner renamed the room (`text` is the new name), " +
      "`room_picture_changed` / `room_picture_removed` the owner set or removed the room's picture.",
  },
  Attachment: object({
    id: { type: "integer" },
    name: { type: "string" },
    size: { type: "integer", description: "Bytes" },
    contentType: { type: "string" },
    url: { type: "string", description: "`/api/rooms/{roomId}/attachments/{id}`" },
    durationMs: { ...nullable({ type: "integer" }), description: "Recorded audio (voice messages): length in ms" },
    waveform: {
      ...nullable(arrayOf({ type: "integer", minimum: 0, maximum: WAVEFORM_MAX })),
      description: `Recorded audio: ${WAVEFORM_BARS} levels, the loudest at ${WAVEFORM_MAX}`,
    },
  }),
  Message: object({
    id: { type: "integer" },
    roomId: { type: "integer" },
    kind: ref("MessageKind"),
    text: { type: "string", description: "\"\" for system lines and deleted messages; may be \"\" when there are attachments" },
    attachments: { ...arrayOf(ref("Attachment")), description: "In upload order; empty for system lines and deleted messages" },
    createdAt: isoDate(),
    editedAt: { ...nullable(isoDate()), description: "Set once the author edited the text" },
    deletedAt: { ...nullable(isoDate()), description: "Set once deleted; the message stays as a placeholder" },
    author: ref("User"),
    poll: { ...nullable(ref("Poll")), description: "The poll of a `poll` message; null otherwise and once deleted" },
  }),
  PollOption: object({
    id: { type: "integer" },
    text: { type: "string" },
    voteCount: { type: "integer" },
    voters: { ...arrayOf(ref("User")), description: "Earliest first; always empty in an anonymous poll" },
    addedBy: { ...nullable(ref("User")), description: "The author, or a member who suggested it" },
  }),
  PollComment: object({ id: { type: "integer" }, author: ref("User"), text: { type: "string" }, createdAt: isoDate() }),
  Poll: object({
    question: { type: "string" },
    multiple: { type: "boolean", description: "Voters may pick more than one option" },
    maxVotes: { ...nullable({ type: "integer" }), description: "With `multiple`: at most this many options per person" },
    anonymous: { type: "boolean", description: "Nobody sees who voted for what" },
    allowSuggestions: { type: "boolean", description: "Members may add options" },
    allowComments: { type: "boolean", description: "Members may comment" },
    options: arrayOf(ref("PollOption")),
    voterCount: { type: "integer", description: "People who voted; percentages are of this" },
    comments: { ...arrayOf(ref("PollComment")), description: "Oldest first" },
    version: { type: "integer", description: "Grows with every change; the higher of two copies is newer" },
    myVotes: { ...arrayOf({ type: "integer" }), description: "Option ids you voted for" },
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
    avatarUrl: {
      ...nullable({ type: "string" }),
      description: "Picture chosen when the room was created (`/api/rooms/{id}/avatar?v=…`), or null for the default one",
    },
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
  RoomUpdatedEvent: object({
    roomId: { type: "integer" },
    name: { type: "string" },
    avatarUrl: nullable({ type: "string" }),
  }),
  Invitation: {
    ...object({
      roomId: { type: "integer" },
      roomName: { type: "string" },
      roomAvatarUrl: { ...nullable({ type: "string" }), description: "The room's picture (`/api/rooms/{id}/avatar?v=…`), or null" },
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
  RealtimeConfig: object({ key: { type: "string" }, cluster: { type: "string" } }),
  SeedAccount: object({
    id: { type: "integer" },
    username: { type: "string" },
    name: nullable({ type: "string" }),
    password: { type: "string" },
    role: ref("Role"),
    rooms: { ...arrayOf({ type: "string" }), description: "Rooms the account is a member of" },
    note: { type: "string" },
  }),
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
      responses: { 200: json(object({ user: nullable(ref("SessionUser")) }), "`user` is null when not signed in") },
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
      description:
        `Sets the \`${SESSION_COOKIE}\` session cookie, or with \`session: "token"\` returns a token for the ` +
        "`Authorization: Bearer` header instead. Usernames are stored lowercase.",
      security: [],
      requestBody: jsonBody(fromZod(authRequestSchema)),
      responses: {
        201: json(
          { oneOf: [ref("UserResponse"), ref("TokenAuthResponse")] },
          "Signed in as the new user (`TokenAuthResponse` for `session: \"token\"`)",
        ),
        ...badRequest,
        409: error("Username is already taken"),
      },
    },
  },
  "/auth/login": {
    post: {
      tags: [tags.auth],
      summary: "Sign in",
      description:
        `Sets the \`${SESSION_COOKIE}\` session cookie; later requests from this page are then authenticated. ` +
        "Mobile and other non-browser clients send `session: \"token\"` and get a token to send as " +
        "`Authorization: Bearer <token>` instead. Demo accounts: GET /seeds.",
      security: [],
      requestBody: jsonBody(fromZod(authRequestSchema)),
      responses: {
        200: json({ oneOf: [ref("UserResponse"), ref("TokenAuthResponse")] }, "Signed in (`TokenAuthResponse` for `session: \"token\"`)"),
        ...badRequest,
        401: error("Invalid username or password"),
      },
    },
  },
  "/auth/logout": {
    post: {
      tags: [tags.auth],
      summary: "Sign out",
      description: "Deletes the session (of the Bearer token, or of the cookie) and clears the cookie. Works signed out too.",
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

  // ---- administration ------------------------------------------------------
  "/admin/users": {
    get: {
      tags: [tags.admin],
      summary: "Accounts you manage",
      description:
        "A page of the accounts whose role is below yours (superadmin: admins and users; admin: users). " +
        "Ties are broken by username; accounts without a name come last when sorting by name.",
      parameters: [
        { name: "q", in: "query", description: "Username or name contains (empty: anyone)", schema: { type: "string", maxLength: 64 } },
        { name: "page", in: "query", description: "1-based", schema: { type: "integer", minimum: 1, default: 1 } },
        { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: ADMIN_DEFAULT_PAGE_SIZE } },
        { name: "sort", in: "query", description: "`role` sorts by rank", schema: { type: "string", enum: [...ADMIN_USER_SORT_FIELDS], default: "username" } },
        { name: "order", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "asc" } },
      ],
      responses: {
        200: json(
          object({
            users: arrayOf(ref("AdminUser")),
            total: { type: "integer", description: "Matching accounts on all pages" },
            page: { type: "integer" },
            pageSize: { type: "integer" },
          }),
          "One page of accounts",
        ),
        ...badRequest,
        ...unauthorized,
        403: error("Not an admin or superadmin"),
      },
    },
    post: {
      tags: [tags.admin],
      summary: "Create an account",
      description: "`role` must be below yours. The username is stored lowercase.",
      requestBody: jsonBody(fromZod(createAdminUserSchema)),
      responses: {
        201: json(ref("AdminUser"), "The new account"),
        ...badRequest,
        ...unauthorized,
        403: error("Not an admin, or the role isn't below yours"),
        409: error("Username is already taken"),
      },
    },
  },
  "/admin/users/{id}": {
    patch: {
      tags: [tags.admin],
      summary: "Edit an account",
      description:
        "Name (`null` or \"\" clears it), role (below yours) and password. A new password ends all the account's sessions. " +
        "A name change broadcasts `user:updated`.",
      parameters: [idParam("id", "User id")],
      requestBody: jsonBody(fromZod(updateAdminUserSchema)),
      responses: {
        200: json(ref("AdminUser"), "The updated account"),
        ...badRequest,
        ...unauthorized,
        403: error("Not an admin, or the role isn't below yours"),
        404: error("No such account, or not one you manage"),
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
      description:
        "You become its owner. `inviteIds` are invited (unknown ids and yourself are skipped); they join once they accept. " +
        "`avatar` is an optional picture: a PNG, JPEG or WebP image of up to 1 MB, base64-encoded (no `data:` prefix); clients scale it to 256 px first.",
      requestBody: jsonBody(fromZod(createRoomSchema)),
      responses: { 201: json(ref("Room"), "The new room"), ...badRequest, ...unauthorized },
    },
  },
  "/rooms/{roomId}/avatar": {
    get: {
      tags: [tags.rooms],
      summary: "A room's picture",
      description: "For members and people invited to the room. Use the versioned `Room.avatarUrl`: responses are cached for a year.",
      parameters: [idParam("roomId", "Room id")],
      responses: {
        200: {
          description: "The image",
          content: Object.fromEntries(AVATAR_CONTENT_TYPES.map((t) => [t, { schema: { type: "string", contentMediaType: t } }])),
        },
        ...unauthorized,
        404: error("The room has no picture, or you're neither a member nor invited"),
      },
    },
  },
  "/rooms/{roomId}": {
    get: {
      tags: [tags.rooms],
      summary: "One room",
      parameters: [roomId],
      responses: { 200: json(ref("Room"), "The room"), ...unauthorized, ...roomNotFound },
    },
    patch: {
      tags: [tags.rooms],
      summary: "Rename the room or change its picture",
      description:
        "Owner only. Send `name`, `avatar` (a PNG, JPEG or WebP image of up to 1 MB, base64-encoded) or `avatar: null` to remove the picture; " +
        "fields left out stay. Each actual change posts a system line (`room_renamed`, `room_picture_changed`, `room_picture_removed`), " +
        "broadcasts `room:updated` on the room channel and re-sends `invitation:added` to people invited.",
      parameters: [roomId],
      requestBody: jsonBody(fromZod(updateRoomSchema)),
      responses: {
        200: json(ref("RoomUpdatedEvent"), "The room's name and picture after the change"),
        ...badRequest,
        ...unauthorized,
        403: error("Only the owner can change the room"),
        ...roomNotFound,
      },
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
      description:
        "Text, attachments uploaded beforehand with `POST /rooms/{roomId}/attachments`, or both. " +
        `Up to ${ATTACHMENTS_PER_MESSAGE} attachments, each sent with one message only. ` +
        "Broadcast to the room as `message:created` (not echoed to the sender's socket if `X-Socket-Id` is sent).",
      parameters: [roomId],
      requestBody: jsonBody(fromZod(createMessageSchema)),
      responses: { 201: json(ref("Message"), "The new message"), ...badRequest, ...unauthorized, ...roomNotFound },
    },
  },
  "/rooms/{roomId}/messages/{messageId}": {
    patch: {
      tags: [tags.messages],
      summary: "Edit your message",
      description:
        "Only the author, only regular messages that aren't deleted and aren't voice messages (those can only be deleted). " +
        "The text may be emptied only if the message has attachments " +
        "(the attachments themselves can't be changed). Broadcast as `message:updated`.",
      parameters: [roomId, idParam("messageId", "Message id")],
      requestBody: jsonBody(fromZod(updateMessageSchema)),
      responses: {
        200: json(ref("Message"), "The edited message (`editedAt` set)"),
        ...badRequest,
        ...unauthorized,
        403: error("You can only edit your own messages, and voice messages can't be edited"),
        404: error("Room or message not found (or it's deleted or a system line)"),
      },
    },
    delete: {
      tags: [tags.messages],
      summary: "Delete a message",
      description:
        "The author, or the room owner for anyone's. It stays as a placeholder (`deletedAt` set, `text` \"\", attachments deleted). " +
        "Broadcast as `message:deleted`.",
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
  "/rooms/{roomId}/attachments": {
    post: {
      tags: [tags.messages],
      summary: "Upload an attachment",
      description:
        "The file is the raw body, sent as `application/octet-stream`; its type goes in `X-File-Type` and its name, " +
        "URI-encoded, in `X-File-Name`. Then send its `id` in `attachmentIds` of `POST /rooms/{roomId}/messages`. " +
        "Until then only you can download it; uploads never sent are cleaned up after a day.",
      parameters: [
        roomId,
        { name: "X-File-Name", in: "header", description: "File name, URI-encoded", schema: { type: "string" } },
        { name: "X-File-Type", in: "header", description: "MIME type, e.g. `image/png`", schema: { type: "string" } },
        {
          name: "X-Audio-Duration",
          in: "header",
          description: "Audio only, optional: length in ms (stored as `durationMs`)",
          schema: { type: "integer" },
        },
        {
          name: "X-Audio-Waveform",
          in: "header",
          description: `Audio only, optional: ${WAVEFORM_BARS} comma-separated levels 0–${WAVEFORM_MAX} (stored as \`waveform\`; ignored if malformed)`,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
      },
      responses: {
        201: json(ref("Attachment"), "The upload, not yet attached to a message"),
        400: error("The file is empty"),
        ...unauthorized,
        ...roomNotFound,
        413: error(`The file is larger than ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB`),
      },
    },
  },
  "/rooms/{roomId}/attachments/{attachmentId}": {
    get: {
      tags: [tags.messages],
      summary: "Download an attachment",
      description:
        "PNG, JPEG, GIF, WebP and AVIF images and WebM, Ogg, MP4, MPEG, AAC and WAV audio (voice messages) are served " +
        "inline with their type; anything else as an `application/octet-stream` download with the original name. " +
        "A single `Range: bytes=…` is supported (206).",
      parameters: [roomId, idParam("attachmentId", "Attachment id")],
      responses: {
        200: { description: "The file", content: { "*/*": { schema: { type: "string", format: "binary" } } } },
        206: { description: "The requested byte range" },
        400: error("Invalid attachment id"),
        ...unauthorized,
        404: error("No such room or attachment, or its message was deleted"),
        416: { description: "The range is outside the file" },
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

  // ---- polls ---------------------------------------------------------------
  "/rooms/{roomId}/polls": {
    post: {
      tags: [tags.polls],
      summary: "Create a poll",
      description:
        `Room owner only. Up to ${POLL_MAX_OPTIONS} options, all different. The poll is a message of kind \`poll\`, ` +
        "broadcast as `message:created`; delete it like any message (`DELETE /rooms/{roomId}/messages/{messageId}`).",
      parameters: [roomId],
      requestBody: jsonBody(fromZod(createPollSchema)),
      responses: {
        201: json(ref("Message"), "The poll's message"),
        ...badRequest,
        ...unauthorized,
        403: error("Only the room owner can create polls"),
        ...roomNotFound,
      },
    },
  },
  "/rooms/{roomId}/polls/{messageId}/votes": {
    put: {
      tags: [tags.polls],
      summary: "Vote",
      description:
        "Replaces your vote with `optionIds` (`[]` takes it back): one option unless the poll is `multiple`, " +
        "at most `maxVotes` if set. The room gets `poll:updated` with the poll's new state; your other tabs get `poll:voted`.",
      parameters: [roomId, idParam("messageId", "The poll's message id")],
      requestBody: jsonBody(fromZod(pollVoteSchema)),
      responses: {
        200: json(ref("Poll"), "The poll as you see it"),
        ...badRequest,
        ...unauthorized,
        404: error("Room or poll not found"),
      },
    },
  },
  "/rooms/{roomId}/polls/{messageId}/options": {
    post: {
      tags: [tags.polls],
      summary: "Suggest an option",
      description: "Anyone if the poll has `allowSuggestions`, otherwise only its author. Broadcast as `poll:updated`.",
      parameters: [roomId, idParam("messageId", "The poll's message id")],
      requestBody: jsonBody(fromZod(pollOptionSchema)),
      responses: {
        201: json(ref("Poll"), "The poll with the new option"),
        ...badRequest,
        ...unauthorized,
        403: error("The poll doesn't take suggestions"),
        404: error("Room or poll not found"),
        409: error("The poll already has this option"),
      },
    },
  },
  "/rooms/{roomId}/polls/{messageId}/comments": {
    post: {
      tags: [tags.polls],
      summary: "Comment on a poll",
      description: "Only if the poll has `allowComments`. Broadcast as `poll:updated`.",
      parameters: [roomId, idParam("messageId", "The poll's message id")],
      requestBody: jsonBody(fromZod(pollCommentSchema)),
      responses: {
        201: json(ref("Poll"), "The poll with the new comment"),
        ...badRequest,
        ...unauthorized,
        403: error("Comments are off for this poll"),
        404: error("Room or poll not found"),
      },
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
      summary: "Pusher Channels key and cluster",
      description: "What pusher-js needs to connect: `new Pusher(key, { cluster, channelAuthorization: { endpoint: \"/api/realtime/pusher/auth\" } })`.",
      security: [],
      responses: { 200: json(ref("RealtimeConfig"), "The Pusher app to connect to") },
    },
  },
  "/realtime/pusher/auth": {
    post: {
      tags: [tags.realtime],
      summary: "Authorize a Pusher channel subscription",
      description:
        "Called by pusher-js. `presence-online`: anyone signed in; " +
        "`private-user-{id}`: only that user; `private-room-{id}`: only room members.",
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
      "here first and the browser sends the cookie with every later request. Mobile and other non-browser clients " +
      "sign in with `session: \"token\"` and send `Authorization: Bearer <token>` instead. Links in responses " +
      "(`avatarUrl`, attachment `url`) are paths on this server.\n\n" +
      "Real-time events go through Pusher Channels, with the key and cluster from **GET /realtime/config**. " +
      "pusher-js gets private and presence channel signatures from **POST /realtime/pusher/auth**, authenticated the same way (cookie or Bearer). " +
      "Channels: `presence-online` (anyone signed in), `private-user-{id}` (only that user), `private-room-{id}` " +
      "(room members). " +
      "Send the Pusher socket id in the `X-Socket-Id` header to keep your own connection from receiving the event your request caused.",
  },
  servers: [{ url: "/api" }],
  tags: Object.values(tags).map((name) => ({ name })),
  security: [{ sessionCookie: [] }, { bearerToken: [] }],
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: SESSION_COOKIE, description: "Set by POST /auth/login" },
      bearerToken: { type: "http", scheme: "bearer", description: "Returned by POST /auth/login with `session: \"token\"`" },
    },
    schemas,
  },
  paths,
};
