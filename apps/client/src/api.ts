import {
  AUDIO_DURATION_HEADER,
  AUDIO_WAVEFORM_HEADER,
  FILE_NAME_HEADER,
  FILE_TYPE_HEADER,
  SOCKET_ID_HEADER,
  type AdminUser,
  type AdminUsersPage,
  type AdminUsersQuery,
  type Attachment,
  type CreateAdminUserInput,
  type MeResponse,
  type SessionUser,
  type UpdateAdminUserInput,
  type BlockInput,
  type BlocksEvent,
  type CreateMessageInput,
  type CreatePollInput,
  type CreateRoomInput,
  type UpdateRoomInput,
  type RoomUpdatedEvent,
  type Credentials,
  type Invitation,
  type InviteInput,
  type Message,
  type PhoenixTokenResponse,
  type Poll,
  type PollCommentInput,
  type PollOptionInput,
  type PollVoteInput,
  type RealtimeConfig,
  type MessagesResponse,
  type Receipt,
  type Room,
  type RoomsPage,
  type RoomInvite,
  type RoomMember,
  type SeedsResponse,
  type TypingInput,
  type UpdateMessageInput,
  type UpdateProfileInput,
  type UpdateReceiptInput,
  type User,
} from "@pm/shared";
import { getSocketId } from "./realtime";
import { voiceMetaOf } from "./lib/voice";

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A Blob body is sent as is, with its own type (unless `extraHeaders` sets one); anything else as JSON. */
async function request<T>(path: string, method = "GET", body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const isBlob = body instanceof Blob;
  const headers: Record<string, string> = { "Content-Type": isBlob ? body.type : "application/json", ...extraHeaders };
  const socketId = getSocketId();
  if (socketId) headers[SOCKET_ID_HEADER] = socketId;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : isBlob ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiRequestError(res.status, data?.error ?? res.statusText);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const room = (id: number) => `/rooms/${id}`;

export const api = {
  me: () => request<MeResponse>("/auth/me"),
  login: (c: Credentials) => request<{ user: SessionUser }>("/auth/login", "POST", c),
  register: (c: Credentials) => request<{ user: SessionUser }>("/auth/register", "POST", c),
  logout: () => request<void>("/auth/logout", "POST"),
  updateProfile: (p: UpdateProfileInput) => request<{ user: SessionUser }>("/auth/me", "PATCH", p),
  uploadAvatar: (image: Blob) => request<{ user: SessionUser }>("/auth/me/avatar", "PUT", image),
  removeAvatar: () => request<{ user: SessionUser }>("/auth/me/avatar", "DELETE"),

  /** Administration (admins and superadmins): accounts with a role below the caller's. */
  adminListUsers: (query: AdminUsersQuery) =>
    request<AdminUsersPage>(
      `/admin/users?${new URLSearchParams(
        Object.entries(query).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])),
      )}`,
    ),
  adminCreateUser: (input: CreateAdminUserInput) => request<AdminUser>("/admin/users", "POST", input),
  adminUpdateUser: (id: number, input: UpdateAdminUserInput) => request<AdminUser>(`/admin/users/${id}`, "PATCH", input),

  searchUsers: (q: string) => request<User[]>(`/users?q=${encodeURIComponent(q)}`),

  getBlocks: () => request<BlocksEvent>("/blocks"),
  block: (input: BlockInput) => request<BlocksEvent>("/blocks", "POST", input),
  unblock: (userId: number) => request<BlocksEvent>(`/blocks/${userId}`, "DELETE"),

  getRooms: (query: { limit?: number; before?: string } = {}) => {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.before !== undefined) params.set("before", query.before);
    const qs = params.toString();
    return request<RoomsPage>(qs ? `/rooms?${qs}` : "/rooms");
  },
  getRoom: (roomId: number) => request<Room>(room(roomId)),
  createRoom: (input: CreateRoomInput) => request<Room>("/rooms", "POST", input),
  updateRoom: (roomId: number, input: UpdateRoomInput) => request<RoomUpdatedEvent>(room(roomId), "PATCH", input),
  invite: (roomId: number, input: InviteInput) =>
    request<{ invites: RoomInvite[] }>(`${room(roomId)}/invites`, "POST", input),
  cancelInvite: (roomId: number, userId: number) =>
    request<{ invites: RoomInvite[] }>(`${room(roomId)}/invites/${userId}`, "DELETE"),
  removeMember: (roomId: number, userId: number) =>
    request<{ members: RoomMember[] }>(`${room(roomId)}/members/${userId}`, "DELETE"),

  /**
   * Latest page; with `before` the page of messages just older than that id;
   * with `after` the oldest page of messages newer than that id.
   */
  getMessages: (roomId: number, cursor: { before?: number; after?: number } = {}) => {
    const query =
      cursor.before !== undefined ? `?before=${cursor.before}` : cursor.after !== undefined ? `?after=${cursor.after}` : "";
    return request<MessagesResponse>(`${room(roomId)}/messages${query}`);
  },
  createMessage: (roomId: number, input: CreateMessageInput) =>
    request<Message>(`${room(roomId)}/messages`, "POST", input),
  /**
   * Uploads a file to attach to a message sent afterwards (see `CreateMessageInput.attachmentIds`).
   * A voice message recorded here also sends its length and waveform.
   */
  uploadAttachment: (roomId: number, file: File) => {
    const voice = voiceMetaOf(file);
    return request<Attachment>(`${room(roomId)}/attachments`, "POST", file, {
      "Content-Type": "application/octet-stream",
      [FILE_TYPE_HEADER]: file.type || "application/octet-stream",
      [FILE_NAME_HEADER]: encodeURIComponent(file.name),
      ...(voice && {
        [AUDIO_DURATION_HEADER]: String(voice.durationMs),
        [AUDIO_WAVEFORM_HEADER]: voice.waveform.join(","),
      }),
    });
  },
  updateMessage: (roomId: number, messageId: number, input: UpdateMessageInput) =>
    request<Message>(`${room(roomId)}/messages/${messageId}`, "PATCH", input),
  deleteMessage: (roomId: number, messageId: number) =>
    request<Message>(`${room(roomId)}/messages/${messageId}`, "DELETE"),
  /** Room owner only; returns the poll's message. */
  createPoll: (roomId: number, input: CreatePollInput) => request<Message>(`${room(roomId)}/polls`, "POST", input),
  /** Replaces the caller's vote; `optionIds: []` takes it back. */
  votePoll: (roomId: number, messageId: number, input: PollVoteInput) =>
    request<Poll>(`${room(roomId)}/polls/${messageId}/votes`, "PUT", input),
  addPollOption: (roomId: number, messageId: number, input: PollOptionInput) =>
    request<Poll>(`${room(roomId)}/polls/${messageId}/options`, "POST", input),
  commentPoll: (roomId: number, messageId: number, input: PollCommentInput) =>
    request<Poll>(`${room(roomId)}/polls/${messageId}/comments`, "POST", input),
  updateReceipt: (roomId: number, input: UpdateReceiptInput) =>
    request<Receipt>(`${room(roomId)}/receipts`, "POST", input),
  sendTyping: (roomId: number, input: TypingInput) =>
    request<void>(`${room(roomId)}/typing`, "POST", input),

  getInvitations: () => request<Invitation[]>("/invites"),
  acceptInvitation: (roomId: number) => request<Room>(`/invites/${roomId}/accept`, "POST"),
  declineInvitation: (roomId: number) => request<void>(`/invites/${roomId}/decline`, "POST"),

  getRealtimeConfig: () => request<RealtimeConfig>("/realtime/config"),
  getPhoenixToken: () => request<PhoenixTokenResponse>("/realtime/phoenix/token"),


  /** Public: demo accounts from `pnpm db:seed` with their passwords. */
  getSeeds: () => request<SeedsResponse>("/seeds"),
};
