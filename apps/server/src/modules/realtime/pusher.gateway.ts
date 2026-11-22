import Pusher from "pusher";
import type { ChannelGrant, RealtimePublisher } from "./realtime.publisher.js";

export interface PusherConfig {
  appId: string;
  key: string;
  secret: string;
  cluster: string;
}

/** Realtime through Pusher Channels: publishes via its HTTP API and signs subscriptions for pusher-js. */
export class PusherGateway implements RealtimePublisher {
  private readonly pusher: Pusher;

  constructor(readonly config: PusherConfig) {
    this.pusher = new Pusher({ ...config, useTLS: true });
  }

  publish(channel: string, event: string, data: unknown, exceptSocketId?: string) {
    this.pusher
      .trigger(channel, event, data, exceptSocketId ? { socket_id: exceptSocketId } : undefined)
      .catch((err) => console.error(`Pusher trigger "${event}" on ${channel} failed:`, err));
  }

  /** The signature pusher-js needs for a subscription `RealtimeService` granted. */
  sign(socketId: string, channel: string, grant: ChannelGrant): object {
    return grant.presence
      ? this.pusher.authorizeChannel(socketId, channel, { user_id: grant.presence.id, user_info: grant.presence.info })
      : this.pusher.authorizeChannel(socketId, channel);
  }
}
