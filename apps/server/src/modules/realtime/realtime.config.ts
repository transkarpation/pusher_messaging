import type { RealtimeConfig } from "@pm/shared";
import type { PhoenixConfig } from "./phoenix.gateway.js";
import type { PusherConfig } from "./pusher.gateway.js";

/**
 * The realtime transport, from REALTIME_DRIVER: "ws" (default) for the server's own
 * WebSocket endpoint, "pusher" for Pusher Channels (needs the PUSHER_* variables),
 * "phoenix" for apps/realtime-server-phoenix (needs PHOENIX_SHARED_SECRET).
 */
export function realtimeDriverFromEnv(): RealtimeConfig["driver"] {
  const driver = process.env.REALTIME_DRIVER || "ws";
  if (driver !== "ws" && driver !== "pusher" && driver !== "phoenix") {
    throw new Error(`REALTIME_DRIVER must be "ws", "pusher" or "phoenix", got "${driver}"`);
  }
  return driver;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (needed for REALTIME_DRIVER=${process.env.REALTIME_DRIVER})`);
  return value;
}

export const pusherConfigFromEnv = (): PusherConfig => ({
  appId: required("PUSHER_APP_ID"),
  key: required("PUSHER_KEY"),
  secret: required("PUSHER_SECRET"),
  cluster: required("PUSHER_CLUSTER"),
});

export const phoenixConfigFromEnv = (): PhoenixConfig => ({
  url: (process.env.PHOENIX_URL || "http://localhost:4000").replace(/\/+$/, ""),
  socketUrl: process.env.PHOENIX_SOCKET_URL || "ws://localhost:4000/socket",
  secret: required("PHOENIX_SHARED_SECRET"),
});
