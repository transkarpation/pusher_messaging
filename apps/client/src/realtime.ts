import {
  RealtimeClient,
  createPhoenixConnection,
  createPusherConnection,
  withHost,
  type RealtimeConnection,
} from "@pm/realtime-client";
import { PUSHER_AUTH_PATH, REALTIME_PATH, type RealtimeConfig } from "@pm/shared";
import { ApiRequestError, api } from "./api";

let pending: Promise<RealtimeConnection> | null = null;
let current: RealtimeConnection | null = null;

/** A token for the Phoenix server, or null once the session is gone. */
async function phoenixToken(): Promise<string | null> {
  try {
    return (await api.getPhoenixToken()).token;
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) return null;
    throw err;
  }
}

/**
 * Opens a connection with the transport the server uses. The own WebSocket and Pusher
 * authenticate with the session cookie, Phoenix with a token the API issues for it.
 */
async function open(config: RealtimeConfig): Promise<RealtimeConnection> {
  if (config.driver === "phoenix") {
    const { Socket, Presence } = await import("phoenix"); // loaded only for the Phoenix driver
    return createPhoenixConnection({
      Socket,
      Presence,
      url: withHost(config.socketUrl, location.hostname),
      getToken: phoenixToken,
    });
  }
  if (config.driver === "pusher") {
    const { default: Pusher } = await import("pusher-js"); // loaded only for the Pusher driver
    return createPusherConnection({ Pusher, key: config.key, cluster: config.cluster, authEndpoint: PUSHER_AUTH_PATH });
  }
  // Same origin as the page (Vite proxies it in development).
  return new RealtimeClient({ url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${REALTIME_PATH}` });
}

/**
 * The single realtime connection, opened on first use with the transport from
 * GET /api/realtime/config (REALTIME_DRIVER on the server: own WebSocket, Pusher or Phoenix).
 */
export function getRealtime(): Promise<RealtimeConnection> {
  if (pending) return pending;
  const attempt: Promise<RealtimeConnection> = api
    .getRealtimeConfig()
    .then(open)
    .then((conn) => {
      if (pending !== attempt) {
        conn.disconnect(); // disconnectRealtime() ran while this was opening
        throw new Error("Realtime was disconnected");
      }
      current = conn;
      return conn;
    })
    .catch((err) => {
      if (pending === attempt) pending = null; // allow a retry
      throw err;
    });
  pending = attempt;
  return attempt;
}

/** The current connection's socket id, attached to API calls so the server doesn't echo our own events. */
export const getSocketId = () => current?.socketId;

export function disconnectRealtime() {
  pending = null;
  current?.disconnect();
  current = null;
}
