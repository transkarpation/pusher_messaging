import type { RealtimeConfig } from "@pm/shared";
import type { PusherConfig } from "./pusher.gateway.js";

/**
 * The realtime transport, from REALTIME_DRIVER: "ws" (default) for the server's own
 * WebSocket endpoint, "pusher" for Pusher Channels (needs the PUSHER_* variables).
 */
export function realtimeDriverFromEnv(): RealtimeConfig["driver"] {
  const driver = process.env.REALTIME_DRIVER || "ws";
  if (driver !== "ws" && driver !== "pusher") throw new Error(`REALTIME_DRIVER must be "ws" or "pusher", got "${driver}"`);
  return driver;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (needed for REALTIME_DRIVER=pusher)`);
  return value;
}

export const pusherConfigFromEnv = (): PusherConfig => ({
  appId: required("PUSHER_APP_ID"),
  key: required("PUSHER_KEY"),
  secret: required("PUSHER_SECRET"),
  cluster: required("PUSHER_CLUSTER"),
});
