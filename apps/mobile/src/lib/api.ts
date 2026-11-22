import {
  SOCKET_ID_HEADER,
  resolveApiUrl,
  type AuthRequest,
  type CreateMessageInput,
  type Message,
  type MessagesResponse,
  type PhoenixTokenResponse,
  type RealtimeConfig,
  type Room,
  type SeedsResponse,
  type TokenAuthResponse,
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

export const api = {
  login: (c: Omit<AuthRequest, "session">) =>
    request<TokenAuthResponse>("/auth/login", "POST", { ...c, session: "token" } satisfies AuthRequest),
  register: (c: Omit<AuthRequest, "session">) =>
    request<TokenAuthResponse>("/auth/register", "POST", { ...c, session: "token" } satisfies AuthRequest),
  logout: () => request<void>("/auth/logout", "POST"),
  me: () => request<{ user: User | null }>("/auth/me"),

  getRooms: () => request<Room[]>("/rooms"),
  getMessages: (roomId: number, before?: number) =>
    request<MessagesResponse>(`${room(roomId)}/messages${before !== undefined ? `?before=${before}` : ""}`),
  createMessage: (roomId: number, input: CreateMessageInput) =>
    request<Message>(`${room(roomId)}/messages`, "POST", input),

  getRealtimeConfig: () => request<RealtimeConfig>("/realtime/config"),
  getPhoenixToken: () => request<PhoenixTokenResponse>("/realtime/phoenix/token"),

  /** Public: demo accounts from `pnpm db:seed` with their passwords (404 on a production server). */
  getSeeds: () => request<SeedsResponse>("/seeds"),

};
