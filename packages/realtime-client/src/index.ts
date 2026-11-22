/**
 * Realtime connections for the web and mobile apps, behind one interface
 * (`RealtimeConnection`) whichever transport the server uses:
 *
 * - `RealtimeClient`: the server's own WebSocket endpoint (apps/server, realtime module).
 *   It reconnects on its own and resubscribes every channel afterwards. Works in browsers
 *   and React Native, which both have a global WebSocket.
 * - `createPusherConnection`: Pusher Channels through pusher-js, adapted to the same interface.
 * - `createPhoenixConnection`: the Phoenix server (apps/realtime-server-phoenix) through phoenix.js.
 *
 *   const rt = new RealtimeClient({ url: "wss://chat.example.com/api/realtime/ws" });
 *   rt.subscribe("private-room-1").bind("message:created", (m: Message) => …);
 */

export {
  Channel,
  MEMBER_ADDED,
  MEMBER_REMOVED,
  SUBSCRIBED,
  SUBSCRIPTION_ERROR,
  type ConnectionState,
  type RealtimeConnection,
  type SubscriptionError,
} from "./connection";
export { RealtimeClient, type RealtimeClientOptions } from "./client";
export { createPusherConnection, type PusherConnectionOptions } from "./pusher";
export { createPhoenixConnection, withHost, type PhoenixConnectionOptions } from "./phoenix";
export type { PresenceMember } from "@pm/shared";
