import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import {
  RealtimeClient,
  createPhoenixConnection,
  createPusherConnection,
  withHost,
  type RealtimeConnection,
} from "@pm/realtime-client";
import { PUSHER_AUTH_PATH, REALTIME_PATH, type RealtimeConfig } from "@pm/shared";
import { ApiRequestError, api, authHeaders, setSocketId } from "./api";
import { API_URL } from "./config";

let pending: Promise<RealtimeConnection> | null = null;
let current: { conn: RealtimeConnection; stop: () => void } | null = null;

/** A token for the Phoenix server, or null once the session is gone. */
async function phoenixToken(): Promise<string | null> {
  try {
    return (await api.getPhoenixToken()).token;
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) return null;
    throw err;
  }
}

/** Opens a connection with the transport the server uses, authenticated with the Bearer token. */
async function open(config: RealtimeConfig): Promise<RealtimeConnection> {
  if (config.driver === "phoenix") {
    const { Socket, Presence } = await import("phoenix"); // loaded only for the Phoenix driver
    // A dev config says localhost; reach Phoenix on the same host as the API (emulator, LAN).
    const apiHost = API_URL.match(/^https?:\/\/([^/:]+)/)?.[1] ?? "localhost";
    return createPhoenixConnection({ Socket, Presence, url: withHost(config.socketUrl, apiHost), getToken: phoenixToken });
  }
  if (config.driver === "pusher") {
    const { default: Pusher } = await import("pusher-js/react-native"); // loaded only for the Pusher driver
    return createPusherConnection({
      Pusher,
      key: config.key,
      cluster: config.cluster,
      authEndpoint: API_URL + PUSHER_AUTH_PATH,
      headers: authHeaders,
    });
  }
  // React Native's WebSocket can send headers in the handshake.
  return new RealtimeClient({ url: API_URL.replace(/^http/, "ws") + REALTIME_PATH, headers: authHeaders });
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
