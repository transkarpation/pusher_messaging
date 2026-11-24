/**
 * The realtime connection for the web and mobile apps: Pusher Channels through pusher-js,
 * behind a small transport-neutral interface (`RealtimeConnection`).
 *
 *   const rt = createPusherConnection({ Pusher, key, cluster, authEndpoint: PUSHER_AUTH_PATH });
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
export { createPusherConnection, type PusherConnectionOptions } from "./pusher";
export type { PresenceMember } from "@pm/shared";
