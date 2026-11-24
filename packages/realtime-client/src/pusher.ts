import type { PresenceMember } from "@pm/shared";
import {
  Channel,
  MEMBER_ADDED,
  MEMBER_REMOVED,
  SUBSCRIBED,
  SUBSCRIPTION_ERROR,
  type ConnectionState,
  type RealtimeConnection,
  type SubscriptionError,
} from "./connection";

/*
 * The parts of pusher-js this adapter uses, typed structurally so the package doesn't depend
 * on pusher-js: the app passes in the constructor it imported ("pusher-js" in browsers,
 * "pusher-js/react-native" in React Native).
 */
interface PusherChannelLike {
  bind_global(callback: (event: string, data: unknown) => void): unknown;
  unbind_all(): unknown;
}
interface PusherLike {
  connection: {
    state: string;
    socket_id: string;
    bind(event: string, callback: (change: { previous: string; current: string }) => void): unknown;
  };
  subscribe(name: string): PusherChannelLike;
  unsubscribe(name: string): void;
  disconnect(): void;
}
/** pusher-js's `Pusher` class. Its options type is pusher-js's own, hence `any`. */
type PusherCtor = new (key: string, options: any) => PusherLike;

/** pusher-js presence snapshot (`Members`). */
interface PusherMembers {
  each(callback: (member: PresenceMember) => void): void;
}

export interface PusherConnectionOptions {
  /** The `Pusher` class from pusher-js. */
  Pusher: PusherCtor;
  key: string;
  cluster: string;
  /** Full URL (or same-origin path) of the server's channel authorization endpoint (PUSHER_AUTH_PATH). */
  authEndpoint: string;
  /** Headers for authorization requests, read on each one: `Authorization: Bearer …` outside browsers. */
  headers?: () => Record<string, string>;
}

const toState = (pusherState: string): ConnectionState => {
  switch (pusherState) {
    case "connected":
      return "connected";
    case "unavailable":
      return "unavailable";
    case "failed":
    case "disconnected":
      return "closed";
    default: // initialized, connecting
      return "connecting";
  }
};

const isMembers = (data: unknown): data is PusherMembers =>
  typeof (data as PusherMembers | null)?.each === "function";

/**
 * A `RealtimeConnection` over Pusher Channels. pusher-js events are translated to the
 * transport-neutral ones: `pusher:subscription_succeeded` → SUBSCRIBED (with a member
 * array on presence channels), `pusher:subscription_error` → SUBSCRIPTION_ERROR,
 * `pusher:member_added` / `pusher:member_removed` → MEMBER_ADDED / MEMBER_REMOVED.
 */
export function createPusherConnection(options: PusherConnectionOptions): RealtimeConnection {
  const pusher = new options.Pusher(options.key, {
    cluster: options.cluster,
    channelAuthorization: {
      endpoint: options.authEndpoint,
      transport: "ajax",
      ...(options.headers && { headersProvider: options.headers }),
    },
  });
  const channels = new Map<string, Channel>();
  const pusherChannels = new Map<string, PusherChannelLike>();
  const stateListeners = new Set<(state: ConnectionState) => void>();
  let state = toState(pusher.connection.state);

  pusher.connection.bind("state_change", ({ current }) => {
    const next = toState(current);
    if (next !== "connected") {
      for (const channel of channels.values()) {
        channel.subscribed = false;
        channel.members.clear();
      }
    }
    if (next === state) return;
    state = next;
    for (const listener of [...stateListeners]) listener(next);
  });

  const forward = (channel: Channel) => (event: string, data: unknown) => {
    switch (event) {
      case "pusher:subscription_succeeded": {
        channel.subscribed = true;
        let members: PresenceMember[] | undefined;
        if (isMembers(data)) {
          members = [];
          data.each((m) => members!.push({ id: m.id, info: m.info }));
          channel.members.clear();
          for (const m of members) channel.members.set(m.id, m);
        }
        channel.emit(SUBSCRIBED, members);
        break;
      }
      case "pusher:subscription_error": {
        const e = data as { status?: number; error?: string } | undefined;
        channel.emit(SUBSCRIPTION_ERROR, {
          status: e?.status ?? 0,
          error: e?.error ?? "Subscription failed",
        } satisfies SubscriptionError);
        break;
      }
      case "pusher:member_added": {
        const m = data as PresenceMember;
        channel.members.set(m.id, { id: m.id, info: m.info });
        channel.emit(MEMBER_ADDED, { id: m.id, info: m.info });
        break;
      }
      case "pusher:member_removed": {
        const m = data as PresenceMember;
        channel.members.delete(m.id);
        channel.emit(MEMBER_REMOVED, { id: m.id, info: m.info });
        break;
      }
      default:
        if (!event.startsWith("pusher:") && !event.startsWith("pusher_internal:")) channel.emit(event, data);
    }
  };

  return {
    get state() {
      return state;
    },
    get socketId() {
      return state === "connected" ? pusher.connection.socket_id : undefined;
    },

    subscribe(name) {
      let channel = channels.get(name);
      if (channel) return channel;
      channel = new Channel(name);
      channels.set(name, channel);
      const pusherChannel = pusher.subscribe(name);
      pusherChannel.bind_global(forward(channel));
      pusherChannels.set(name, pusherChannel);
      return channel;
    },

    unsubscribe(name) {
      const channel = channels.get(name);
      if (!channel) return;
      channels.delete(name);
      channel.subscribed = false;
      channel.members.clear();
      pusherChannels.get(name)?.unbind_all(); // drops our forwarder
      pusherChannels.delete(name);
      pusher.unsubscribe(name);
    },

    channel: (name) => channels.get(name),

    onStateChange(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },

    reconnectNow() {
      // pusher-js watches the network and retries by itself.
    },

    disconnect() {
      for (const channel of channels.values()) channel.unbindAll();
      channels.clear();
      pusherChannels.clear();
      pusher.disconnect();
    },
  };
}
