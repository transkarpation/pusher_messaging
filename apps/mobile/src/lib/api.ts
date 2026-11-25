import {
  SOCKET_ID_HEADER,
  resolveApiUrl,
  type AuthRequest,
  type CreateMessageInput,
  type CreateRoomInput,
  type CreatePollInput,
  type Message,
  type MessagesResponse,
  type PhoenixTokenResponse,
  type Poll,
  type PollCommentInput,
  type PollOptionInput,
  type PollVoteInput,
  type Receipt,
  type RealtimeConfig,
  type Room,
  type RoomsPage,
  type RoomUpdatedEvent,
  type SeedsResponse,
  type TokenAuthResponse,
  type UpdateReceiptInput,
  type UpdateRoomInput,
  type User,
} from "@pm/shared";
import { API_URL } from "./config";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let token: string | null = null;
let socketId: string | undefined;

/** The session token sent as `Authorization: Bearer` with every request. */
export const setApiToken = (value: string | null) => {
  token = value;
};
/** The realtime socket id, so the server doesn't echo our own events back to us. */
export const setSocketId = (value: string | undefined) => {
  socketId = value;
};

export const authHeaders = (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

/** An `avatarUrl` / attachment `url` from the API (a path) as a full URL on the API server. */
export const absoluteUrl = (path: string) => resolveApiUrl(API_URL, path);

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (socketId) headers[SOCKET_ID_HEADER] = socketId;

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, `Can't reach the server at ${API_URL}`);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiRequestError(res.status, data?.error ?? `Request failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const room = (id: number) => `/rooms/${id}`;

/** Receipt updates on their way to the server (see `api.receiptsSettled`). */
const receiptsInFlight = new Set<Promise<Receipt>>();

export const api = {
  login: (c: Omit<AuthRequest, "session">) =>
    request<TokenAuthResponse>("/auth/login", "POST", { ...c, session: "token" } satisfies AuthRequest),
  register: (c: Omit<AuthRequest, "session">) =>
    request<TokenAuthResponse>("/auth/register", "POST", { ...c, session: "token" } satisfies AuthRequest),
  logout: () => request<void>("/auth/logout", "POST"),
  me: () => request<{ user: User | null }>("/auth/me"),

  /** A page of the user's rooms, most recently active first; `before` is the previous page's `nextCursor`. */
  getRooms: (query: { limit?: number; before?: string } = {}) => {
    const params: string[] = [];
    if (query.limit !== undefined) params.push(`limit=${query.limit}`);
    if (query.before !== undefined) params.push(`before=${encodeURIComponent(query.before)}`);
    return request<RoomsPage>(params.length > 0 ? `/rooms?${params.join("&")}` : "/rooms");
  },
  /** The new room, with the current user as its owner; invitees join once they accept. */
  createRoom: (input: CreateRoomInput) => request<Room>("/rooms", "POST", input),
  /** Room owner only: renames the room and/or changes its picture; returns its new name and picture. */
  updateRoom: (roomId: number, input: UpdateRoomInput) => request<RoomUpdatedEvent>(room(roomId), "PATCH", input),
  searchUsers: (q: string) => request<User[]>(`/users?q=${encodeURIComponent(q)}`),
  getMessages: (roomId: number, before?: number) =>
    request<MessagesResponse>(`${room(roomId)}/messages${before !== undefined ? `?before=${before}` : ""}`),
  createMessage: (roomId: number, input: CreateMessageInput) =>
    request<Message>(`${room(roomId)}/messages`, "POST", input),
  /** Room owner only; returns the poll's message. */
  createPoll: (roomId: number, input: CreatePollInput) => request<Message>(`${room(roomId)}/polls`, "POST", input),
  /** Replaces the user's whole choice; [] takes the vote back. */
  votePoll: (roomId: number, messageId: number, input: PollVoteInput) =>
    request<Poll>(`${room(roomId)}/polls/${messageId}/votes`, "PUT", input),
  addPollOption: (roomId: number, messageId: number, input: PollOptionInput) =>
    request<Poll>(`${room(roomId)}/polls/${messageId}/options`, "POST", input),
  commentPoll: (roomId: number, messageId: number, input: PollCommentInput) =>
    request<Poll>(`${room(roomId)}/polls/${messageId}/comments`, "POST", input),

  /** Moves this user's delivered/read watermarks in a room forward; returns the resulting receipt. */
  updateReceipt: (roomId: number, input: UpdateReceiptInput) => {
    const req = request<Receipt>(`${room(roomId)}/receipts`, "POST", input);
    receiptsInFlight.add(req);
    void req.catch(() => {}).finally(() => receiptsInFlight.delete(req));
    return req;
  },
  /** Resolves once the receipt updates sent so far have finished, so unread counts fetched after it include them. */
  receiptsSettled: () => Promise.allSettled([...receiptsInFlight]),

  getRealtimeConfig: () => request<RealtimeConfig>("/realtime/config"),
  getPhoenixToken: () => request<PhoenixTokenResponse>("/realtime/phoenix/token"),

  /** Public: demo accounts from `pnpm db:seed` with their passwords (404 on a production server). */
  getSeeds: () => request<SeedsResponse>("/seeds"),

};
