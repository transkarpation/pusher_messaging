import type { PresenceMember, PresenceUserInfo } from "@pm/shared";
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
 * The parts of phoenix.js this adapter uses, typed structurally so the package doesn't depend
 * on it: the app imports "phoenix" and passes `Socket` and `Presence` in.
 */
interface PhxPush {
  receive(status: string, callback: (response?: any) => void): PhxPush;
}
interface PhxChannel {
  join(timeout?: number): PhxPush;
  leave(timeout?: number): PhxPush;
  onMessage(event: string, payload: any, ref: any): any;
}
interface PhxSocket {
  connect(): void;
  disconnect(callback?: () => void, code?: number, reason?: string): void;
  channel(topic: string, params?: object): PhxChannel;
  onOpen(callback: () => void): unknown;
  onClose(callback: (event: any) => void): unknown;
  onError(callback: (error: any) => void): unknown;
}
/** A presence entry: one meta per connection of the user (the server tracks `{ info }`). */
interface PhxPresenceEntry {
  metas: { info?: PresenceUserInfo }[];
}
// Callback parameters are optional to match @types/phoenix; phoenix.js always passes them.
interface PhxPresence {
  onJoin(callback: (key?: string, current?: PhxPresenceEntry, joined?: PhxPresenceEntry) => void): void;
  onLeave(callback: (key?: string, current?: PhxPresenceEntry, left?: PhxPresenceEntry) => void): void;
  onSync(callback: () => void): void;
  list<T>(chooser: (key: string, entry: PhxPresenceEntry) => T): T[];
}
type SocketCtor = new (endPoint: string, opts?: any) => PhxSocket;
type PresenceCtor = new (channel: any, opts?: any) => PhxPresence;

export interface PhoenixConnectionOptions {
  /** `Socket` from phoenix.js. */
  Socket: SocketCtor;
  /** `Presence` from phoenix.js. */
  Presence: PresenceCtor;
  /** The endpoint from the server's config, e.g. ws://localhost:4000/socket. */
  url: string;
  /** A fresh connection token (PHOENIX_TOKEN_PATH), or null when signed out (which closes the connection). */
  getToken: () => Promise<string | null>;
}

/** Tokens live 15 minutes on the server; a fresh one is always kept ready for the next (re)connect. */
const TOKEN_REFRESH_MS = 5 * 60_000;
/**
 * After a failed connect, fetch a new token (the old one may have expired, e.g. while the
 * app slept), at most this often: phoenix.js retries quickly while the server is down.
 */
const TOKEN_MIN_AGE_MS = 5_000;
const TOKEN_RETRY_MS = 5_000;

/** Phoenix's own events and replies, which aren't app events. */
const isInternal = (event: string) =>
  event.startsWith("phx_") || event.startsWith("chan_reply_") || event === "presence_state" || event === "presence_diff";

const toMember = (id: string, entry: PhxPresenceEntry | undefined): PresenceMember | null => {
  const info = entry?.metas[0]?.info;
  return info ? { id, info } : null;
};

/** A socket id for one connection; only used to skip echoing our own events, so it needn't be cryptographic. */
const newSocketId = () => {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 24; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
};

interface Entry {
  channel: Channel;
  /** The phoenix.js channel, or null after the server refused the join (retried after a reconnect). */
  phx: PhxChannel | null;
  /** A presence channel joined, waiting for its first `presence_state` to report SUBSCRIBED. */
  awaitingState: boolean;
}

/**
 * A `RealtimeConnection` to the Phoenix server (apps/realtime-server-phoenix) through phoenix.js:
 *
 * - connects with a token from the API (refreshed in the background, since every reconnect
 *   needs a valid one) and a socket id it makes up per connection;
 * - joins one Phoenix channel per app channel (the topic is the channel name);
 * - maps the join reply to SUBSCRIBED / SUBSCRIPTION_ERROR, Phoenix Presence to the member
 *   list and MEMBER_ADDED / MEMBER_REMOVED (a user's first connection in, last one out),
 *   and every other pushed event to the channel's handlers.
 *
 * phoenix.js reconnects and rejoins channels by itself; each rejoin reports SUBSCRIBED again.
 */
export function createPhoenixConnection(options: PhoenixConnectionOptions): RealtimeConnection {
  let state: ConnectionState = "connecting";
  let closed = false;
  let token: string | null = null;
  let tokenAt = 0;
  let refreshing: Promise<void> | null = null;
  let nextSocketId: string | undefined;
  let socketId: string | undefined;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  const entries = new Map<string, Entry>();
  const stateListeners = new Set<(state: ConnectionState) => void>();

  const socket = new options.Socket(options.url, {
    // Called by phoenix.js on every (re)connect.
    params: () => {
      nextSocketId = newSocketId();
      return { token: token ?? "", socket_id: nextSocketId };
    },
  });

  const setState = (next: ConnectionState) => {
    if (next === state) return;
    state = next;
    for (const listener of [...stateListeners]) listener(next);
  };

  const shutDown = () => {
    closed = true;
    clearTimeout(startTimer);
    clearInterval(refreshTimer);
    entries.clear();
    socketId = undefined;
    socket.disconnect();
    setState("closed");
  };

  const refreshToken = (): Promise<void> =>
    (refreshing ??= options
      .getToken()
      .then((fresh) => {
        if (closed) return;
        if (fresh === null) {
          console.warn("Realtime: not signed in, closing the connection");
          shutDown();
          return;
        }
        token = fresh;
        tokenAt = Date.now();
      })
      .catch((err) => console.warn("Realtime: fetching a connection token failed:", err))
      .finally(() => {
        refreshing = null;
      }));

  const refreshTimer = setInterval(() => void refreshToken(), TOKEN_REFRESH_MS);

  /** Connects once there is a token; keeps trying to get one while the API is unreachable. */
  const start = () =>
    void refreshToken().then(() => {
      if (closed) return;
      if (token) {
        socket.connect();
      } else {
        setState("unavailable");
        startTimer = setTimeout(start, TOKEN_RETRY_MS);
      }
    });

  socket.onOpen(() => {
    if (closed) return;
    socketId = nextSocketId;
    setState("connected");
    for (const [name, entry] of entries) if (!entry.phx) join(name, entry);
  });
  socket.onError(() => {
    // Possibly an expired token: have a fresh one ready for phoenix.js's next attempt.
    if (!closed && Date.now() - tokenAt > TOKEN_MIN_AGE_MS) void refreshToken();
  });
  socket.onClose(() => {
    if (closed) return;
    socketId = undefined;
    for (const entry of entries.values()) {
      entry.channel.subscribed = false;
      entry.channel.members.clear();
      entry.awaitingState = false;
    }
    setState("unavailable");
  });

  function join(name: string, entry: Entry) {
    const phx = socket.channel(name, {});
    const presence = new options.Presence(phx);
    const { channel } = entry;
    entry.phx = phx;
    entry.awaitingState = false;
    const current = () => entry.phx === phx && entries.get(name) === entry;

    // phoenix.js passes a null event for push timeouts.
    phx.onMessage = (event: string | null, payload: unknown) => {
      if (current() && typeof event === "string" && !isInternal(event)) channel.emit(event, payload);
      return payload;
    };

    presence.onJoin((key, before, joined) => {
      if (!current() || !channel.subscribed || !key || before) return; // `before`: not the user's first connection
      const member = toMember(key, joined);
      if (!member) return;
      channel.members.set(key, member);
      channel.emit(MEMBER_ADDED, member);
    });
    presence.onLeave((key, remaining, left) => {
      if (!current() || !channel.subscribed || !key || (remaining?.metas.length ?? 0) > 0) return; // still connected elsewhere
      const member = channel.members.get(key) ?? toMember(key, left);
      channel.members.delete(key);
      if (member) channel.emit(MEMBER_REMOVED, member);
    });
    presence.onSync(() => {
      if (!current()) return;
      const members = presence.list(toMember).filter((m): m is PresenceMember => m !== null);
      channel.members.clear();
      for (const m of members) channel.members.set(m.id, m);
      if (entry.awaitingState) {
        entry.awaitingState = false;
        channel.subscribed = true;
        channel.emit(SUBSCRIBED, members);
      }
    });

    // phoenix.js keeps these hooks and runs them again on every rejoin.
    phx
      .join()
      .receive("ok", (reply?: { presence?: boolean }) => {
        if (!current()) return;
        if (reply?.presence) {
          entry.awaitingState = true; // SUBSCRIBED once the member list arrives
        } else {
          channel.subscribed = true;
          channel.emit(SUBSCRIBED, undefined);
        }
      })
      .receive("error", (reply?: { status?: number; reason?: string }) => {
        if (!current()) return;
        const error: SubscriptionError = { status: reply?.status ?? 0, error: reply?.reason ?? "Subscription failed" };
        console.warn(`Realtime: subscribing to ${name} failed (${error.status}): ${error.error}`);
        // phoenix.js would retry every few seconds; try again only after a reconnect instead.
        phx.leave();
        entry.phx = null;
        channel.emit(SUBSCRIPTION_ERROR, error);
      });
  }

  start();

  return {
    get state() {
      return state;
    },
    get socketId() {
      return state === "connected" ? socketId : undefined;
    },

    subscribe(name) {
      const existing = entries.get(name);
      if (existing) return existing.channel;
      const entry: Entry = { channel: new Channel(name), phx: null, awaitingState: false };
      entries.set(name, entry);
      if (!closed) join(name, entry); // phoenix.js sends the join once connected
      return entry.channel;
    },

    unsubscribe(name) {
      const entry = entries.get(name);
      if (!entry) return;
      entries.delete(name);
      entry.channel.subscribed = false;
      entry.channel.members.clear();
      entry.phx?.leave();
      entry.phx = null;
    },

    channel: (name) => entries.get(name)?.channel,

    onStateChange(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },

    reconnectNow() {
      // phoenix.js retries by itself, within 5 seconds at most.
    },

    disconnect() {
      if (!closed) shutDown();
    },
  };
}

/**
 * `socketUrl` from the server's config with `localhost` replaced by `host`, the host the app
 * reaches the API at. A dev config says ws://localhost:4000/socket, which an Android emulator
 * (10.0.2.2) or a phone on the LAN can't reach. Other hosts are left alone.
 */
export function withHost(socketUrl: string, host: string): string {
  return socketUrl.replace(/^(wss?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/, `$1${host}`);
}
