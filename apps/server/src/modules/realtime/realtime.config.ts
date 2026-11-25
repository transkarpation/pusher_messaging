import type { PhoenixConfig } from "./phoenix.gateway.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (the API needs it to talk to apps/realtime-server-phoenix)`);
  return value;
}

/** Where the Phoenix realtime server is and the secret shared with it (PHOENIX_* variables). */
export const phoenixConfigFromEnv = (): PhoenixConfig => ({
  url: (process.env.PHOENIX_URL || "http://localhost:4000").replace(/\/+$/, ""),
  socketUrl: process.env.PHOENIX_SOCKET_URL || "ws://localhost:4000/socket",
  secret: required("PHOENIX_SHARED_SECRET"),
});
