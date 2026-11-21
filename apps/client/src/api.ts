import {
  SOCKET_ID_HEADER,
  type CreateMessageInput,
  type CreateRoomInput,
  type Credentials,
  type Invitation,
  type InviteInput,
  type Message,
  type MessagesResponse,
  type RealtimeConfig,
  type Receipt,
  type Room,
  type RoomInvite,
  type RoomMember,
  type TypingInput,
  type UpdateMessageInput,
  type UpdateProfileInput,
  type UpdateReceiptInput,
  type User,
} from "@pm/shared";
import { getSocketId } from "./lib/socket";

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const socketId = getSocketId();
  if (socketId) headers[SOCKET_ID_HEADER] = socketId;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
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

  searchUsers: (q: string) => request<User[]>(`/users?q=${encodeURIComponent(q)}`),

  getRooms: () => request<Room[]>("/rooms"),
  createRoom: (input: CreateRoomInput) => request<Room>("/rooms", "POST", input),
  invite: (roomId: number, input: InviteInput) =>
    request<{ invites: RoomInvite[] }>(`${room(roomId)}/invites`, "POST", input),
  cancelInvite: (roomId: number, userId: number) =>
    request<{ invites: RoomInvite[] }>(`${room(roomId)}/invites/${userId}`, "DELETE"),
  removeMember: (roomId: number, userId: number) =>
    request<{ members: RoomMember[] }>(`${room(roomId)}/members/${userId}`, "DELETE"),

  /** Latest page, or with `after` the oldest page of messages newer than that id. */
  getMessages: (roomId: number, after?: number) =>
    request<MessagesResponse>(
      `${room(roomId)}/messages${after === undefined ? "" : `?after=${after}`}`,
    ),
  createMessage: (roomId: number, input: CreateMessageInput) =>
    request<Message>(`${room(roomId)}/messages`, "POST", input),
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

  getRealtimeConfig: () => request<RealtimeConfig>("/realtime/config"),
};
