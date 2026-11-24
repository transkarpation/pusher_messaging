import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { createPusherConnection, type RealtimeConnection } from "@pm/realtime-client";
import { PUSHER_AUTH_PATH, type RealtimeConfig } from "@pm/shared";
import { api, authHeaders, setSocketId } from "./api";
import { API_URL } from "./config";

let pending: Promise<RealtimeConnection> | null = null;
let current: { conn: RealtimeConnection; stop: () => void } | null = null;

/** Opens the Pusher connection. Channel authorization requests carry the Bearer token. */
async function open(config: RealtimeConfig): Promise<RealtimeConnection> {
  const { default: Pusher } = await import("pusher-js/react-native");
  return createPusherConnection({
    Pusher,
    key: config.key,
    cluster: config.cluster,
    authEndpoint: API_URL + PUSHER_AUTH_PATH,
    headers: authHeaders,
  });
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
      conn.onStateChange((state) => setSocketId(state === "connected" ? conn.socketId : undefined));
      // Don't sit out the retry delay when the app comes back to the foreground or the network returns.
      const appState = AppState.addEventListener("change", (state) => state === "active" && conn.reconnectNow());
      const netInfo = NetInfo.addEventListener((state) => state.isConnected && conn.reconnectNow());
      current = {
        conn,
        stop: () => {
          appState.remove();
          netInfo();
        },
      };
      return conn;
    })
    .catch((err) => {
      if (pending === attempt) pending = null; // allow a retry
      throw err;
    });
  pending = attempt;
  return attempt;
}

export function disconnectRealtime() {
  pending = null;
  current?.stop();
  current?.conn.disconnect();
  current = null;
  setSocketId(undefined);
}

/** Handlers to bind on a channel, by event name. */
export type Handlers = Record<string, (data: never) => void>;

/** How many screens listen to each channel, per connection. */
const listeners = new WeakMap<RealtimeConnection, Map<string, number>>();

/**
 * Binds `handlers` on the channel `name`, subscribing to it if needed. The returned function
 * unbinds them and leaves the channel once no other screen listens to it. Screens share channels
 * (the room list and an open room both listen to the room's channel), so don't `unbindAll` or
 * `unsubscribe` a channel directly.
 */
export function listen(conn: RealtimeConnection, name: string, handlers: Handlers): () => void {
  let counts = listeners.get(conn);
  if (!counts) listeners.set(conn, (counts = new Map()));
  counts.set(name, (counts.get(name) ?? 0) + 1);
  const channel = conn.subscribe(name);
  for (const [event, handler] of Object.entries(handlers)) channel.bind(event, handler);

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    for (const [event, handler] of Object.entries(handlers)) channel.unbind(event, handler);
    const left = (counts.get(name) ?? 1) - 1;
    if (left > 0) counts.set(name, left);
    else {
      counts.delete(name);
      conn.unsubscribe(name);
    }
  };
}
