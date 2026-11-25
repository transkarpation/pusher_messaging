import { createPhoenixConnection, withHost, type RealtimeConnection } from "@pm/realtime-client";
import type { RealtimeConfig } from "@pm/shared";
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

/** Opens a connection to the Phoenix server, with a token the API issues for the session. */
async function open(config: RealtimeConfig): Promise<RealtimeConnection> {
  const { Socket, Presence } = await import("phoenix");
  return createPhoenixConnection({
    Socket,
    Presence,
    url: withHost(config.socketUrl, location.hostname),
    getToken: phoenixToken,
  });
}

/**
 * The single realtime connection, opened on first use with the Phoenix socket URL from
 * GET /api/realtime/config.
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
