import { createPusherConnection, type RealtimeConnection } from "@pm/realtime-client";
import { PUSHER_AUTH_PATH, type RealtimeConfig } from "@pm/shared";
import { api } from "./api";

let pending: Promise<RealtimeConnection> | null = null;
let current: RealtimeConnection | null = null;

/** Opens the Pusher connection. Channel authorization requests carry the session cookie. */
async function open(config: RealtimeConfig): Promise<RealtimeConnection> {
  const { default: Pusher } = await import("pusher-js");
  return createPusherConnection({ Pusher, key: config.key, cluster: config.cluster, authEndpoint: PUSHER_AUTH_PATH });
}

/**
 * The single realtime connection, opened on first use with the Pusher key and cluster
 * from GET /api/realtime/config.
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
