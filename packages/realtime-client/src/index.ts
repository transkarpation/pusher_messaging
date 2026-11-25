/**
 * The realtime connection for the web and mobile apps: `createPhoenixConnection` connects
 * to the Phoenix server (apps/realtime-server-phoenix) through phoenix.js and exposes it as
 * a `RealtimeConnection` with app-level channels, events and presence.
 *
 *   const rt = createPhoenixConnection({ Socket, Presence, url, getToken });
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
export { createPhoenixConnection, withHost, type PhoenixConnectionOptions } from "./phoenix";
export type { PresenceMember } from "@pm/shared";
