import Pusher from "pusher";

/** Sends realtime events. Other modules depend on this interface, not on Pusher. */
export interface RealtimePublisher {
  /**
   * Sends `event` to everyone subscribed to `channel`, except the connection `exceptSocketId`
   * (the one whose request caused it). Best-effort: failures are logged, never thrown.
   */
  publish(channel: string, event: string, data: unknown, exceptSocketId?: string): void;
}

/** Signs channel subscriptions (Pusher's auth endpoint protocol). */
export interface ChannelAuthorizer {
  authorize(socketId: string, channel: string, presence?: { userId: string; userInfo: object }): object;
}

export interface PusherConfig {
  appId: string;
  key: string;
  secret: string;
  cluster: string;
}

export class PusherGateway implements RealtimePublisher, ChannelAuthorizer {
  private readonly pusher: Pusher;

  constructor(readonly config: PusherConfig) {
    this.pusher = new Pusher({ ...config, useTLS: true });
  }

  publish(channel: string, event: string, data: unknown, exceptSocketId?: string) {
    this.pusher
      .trigger(channel, event, data, exceptSocketId ? { socket_id: exceptSocketId } : undefined)
      .catch((err) => console.error(`Pusher trigger "${event}" on ${channel} failed:`, err));
  }

  authorize(socketId: string, channel: string, presence?: { userId: string; userInfo: object }) {
    return presence
      ? this.pusher.authorizeChannel(socketId, channel, { user_id: presence.userId, user_info: presence.userInfo })
      : this.pusher.authorizeChannel(socketId, channel);
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export const pusherConfigFromEnv = (): PusherConfig => ({
  appId: required("PUSHER_APP_ID"),
  key: required("PUSHER_KEY"),
  secret: required("PUSHER_SECRET"),
  cluster: required("PUSHER_CLUSTER"),
});
