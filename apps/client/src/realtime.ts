import { RealtimeClient } from "@pm/realtime-client";
import { REALTIME_PATH } from "@pm/shared";

let client: RealtimeClient | null = null;

/**
 * The single realtime connection, opened on first use. Same origin as the page (Vite
 * proxies it in development), so the browser authenticates it with the session cookie.
 */
export function getRealtime(): RealtimeClient {
  client ??= new RealtimeClient({
    url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${REALTIME_PATH}`,
  });
  return client;
}

/** The current connection's socket id, attached to API calls so the server doesn't echo our own events. */
export const getSocketId = () => client?.socketId;

export function disconnectRealtime() {
  client?.disconnect();
  client = null;
}
