import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { RealtimeClient } from "@pm/realtime-client";
import { REALTIME_PATH } from "@pm/shared";
import { authHeaders, setSocketId } from "./api";
import { API_URL } from "./config";

let client: RealtimeClient | null = null;
let stopWatching: (() => void) | null = null;

/**
 * The single realtime connection, opened on first use. It authenticates with the Bearer
 * token in the handshake headers, which React Native's WebSocket supports.
 */
export function getRealtime(): RealtimeClient {
  if (client) return client;
  const rt = new RealtimeClient({ url: API_URL.replace(/^http/, "ws") + REALTIME_PATH, headers: authHeaders });
  rt.onStateChange((state) => setSocketId(state === "connected" ? rt.socketId : undefined));

  // Don't sit out the retry delay when the app comes back to the foreground or the network returns.
  const appState = AppState.addEventListener("change", (state) => state === "active" && rt.reconnectNow());
  const netInfo = NetInfo.addEventListener((state) => state.isConnected && rt.reconnectNow());
  stopWatching = () => {
    appState.remove();
    netInfo();
  };

  client = rt;
  return rt;
}

export function disconnectRealtime() {
  stopWatching?.();
  stopWatching = null;
  client?.disconnect();
  client = null;
  setSocketId(undefined);
}
