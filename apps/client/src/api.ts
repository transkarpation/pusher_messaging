import {
  AUDIO_DURATION_HEADER,
  AUDIO_WAVEFORM_HEADER,
  FILE_NAME_HEADER,
  FILE_TYPE_HEADER,
  SOCKET_ID_HEADER,
  type Attachment,
  type BlockInput,
  type BlocksEvent,
  type CreateMessageInput,
  type CreateRoomInput,
  type Credentials,
  type Invitation,
  type InviteInput,
  type Message,
  type MessagesResponse,
  type Receipt,
  type Room,
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
  me: () => request<{ user: User | null }>("/auth/me"),
  login: (c: Credentials) => request<{ user: User }>("/auth/login", "POST", c),
  register: (c: Credentials) => request<{ user: User }>("/auth/register", "POST", c),
  logout: () => request<void>("/auth/logout", "POST"),
  updateProfile: (p: UpdateProfileInput) => request<{ user: User }>("/auth/me", "PATCH", p),
  uploadAvatar: (image: Blob) => request<{ user: User }>("/auth/me/avatar", "PUT", image),
  removeAvatar: () => request<{ user: User }>("/auth/me/avatar", "DELETE"),

  searchUsers: (q: string) => request<User[]>(`/users?q=${encodeURIComponent(q)}`),

  getBlocks: () => request<BlocksEvent>("/blocks"),
  block: (input: BlockInput) => request<BlocksEvent>("/blocks", "POST", input),
  unblock: (userId: number) => request<BlocksEvent>(`/blocks/${userId}`, "DELETE"),

  getRooms: () => request<Room[]>("/rooms"),
  createRoom: (input: CreateRoomInput) => request<Room>("/rooms", "POST", input),
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
  updateReceipt: (roomId: number, input: UpdateReceiptInput) =>
    request<Receipt>(`${room(roomId)}/receipts`, "POST", input),
  sendTyping: (roomId: number, input: TypingInput) =>
    request<void>(`${room(roomId)}/typing`, "POST", input),

  getInvitations: () => request<Invitation[]>("/invites"),
  acceptInvitation: (roomId: number) => request<Room>(`/invites/${roomId}/accept`, "POST"),
  declineInvitation: (roomId: number) => request<void>(`/invites/${roomId}/decline`, "POST"),


  /** Public: demo accounts from `pnpm db:seed` with their passwords. */
  getSeeds: () => request<SeedsResponse>("/seeds"),
};
