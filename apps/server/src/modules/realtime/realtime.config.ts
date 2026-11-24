import type { PusherConfig } from "./pusher.gateway.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (needed for Pusher Channels)`);
  return value;
}

/** Pusher Channels credentials from the PUSHER_* variables. */
export const pusherConfigFromEnv = (): PusherConfig => ({
  appId: required("PUSHER_APP_ID"),
  key: required("PUSHER_KEY"),
  secret: required("PUSHER_SECRET"),
  cluster: required("PUSHER_CLUSTER"),
});
