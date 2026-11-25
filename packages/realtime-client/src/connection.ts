import type { PresenceMember } from "@pm/shared";

/**
 * - connecting: opening the socket, or waiting for the server's `connected`
 * - connected: live; `socketId` is set
 * - unavailable: the connection dropped or couldn't be opened; retrying after a delay
 * - closed: `disconnect()` was called, or the server refused the session. No retries.
 */
export type ConnectionState = "connecting" | "connected" | "unavailable" | "closed";

/** Channel event: the subscription is live (again, after a reconnect). Data: the members on a presence channel. */
export const SUBSCRIBED = "realtime:subscribed";
/** Channel event: the server refused the subscription. Data: `{ status, error }`. */
export const SUBSCRIPTION_ERROR = "realtime:subscription_error";
/** Presence channel event: a user joined. Data: `PresenceMember`. */
export const MEMBER_ADDED = "realtime:member_added";
/** Presence channel event: a user left (their last connection). Data: `PresenceMember`. */
export const MEMBER_REMOVED = "realtime:member_removed";

/** A realtime connection to the Phoenix server. */
export interface RealtimeConnection {
  readonly state: ConnectionState;
  /** Id of the current connection; send it as `X-Socket-Id` so the server skips echoing your own events. */
  readonly socketId: string | undefined;
  /** The channel `name`, subscribing to it if needed. Subscribing again returns the same channel. */
  subscribe(name: string): Channel;
  /** Leaves the channel `name`. Its handlers stay bound to the old `Channel` object, which gets no more events. */
  unsubscribe(name: string): void;
  channel(name: string): Channel | undefined;
  /** Calls `listener` on every state change; returns a function that stops it. */
  onStateChange(listener: (state: ConnectionState) => void): () => void;
  /** Retries right away when waiting to reconnect (e.g. the network is back). */
  reconnectNow(): void;
  /** Closes the connection for good. */
  disconnect(): void;
}

export interface SubscriptionError {
  status: number;
  error: string;
}

type Handler = (data: never) => void;

export class Channel {
  /** Whether the server has confirmed the subscription on the current connection. */
  subscribed = false;
  /** Presence channels: who is on the channel, by user id. */
  readonly members = new Map<string, PresenceMember>();
  private readonly handlers = new Map<string, Set<Handler>>();

  constructor(readonly name: string) {}

  /** Calls `handler` with the data of every `event` on this channel. */
  bind<T>(event: string, handler: (data: T) => void): this {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler as Handler);
    return this;
  }

  /** Removes `handler` from `event`, or every handler of `event` when `handler` is omitted. */
  unbind<T>(event: string, handler?: (data: T) => void): this {
    if (handler) this.handlers.get(event)?.delete(handler as Handler);
    else this.handlers.delete(event);
    return this;
  }

  unbindAll(): this {
    this.handlers.clear();
    return this;
  }

  /** @internal */
  emit(event: string, data: unknown) {
    for (const handler of [...(this.handlers.get(event) ?? [])]) {
      try {
        (handler as (data: unknown) => void)(data);
      } catch (err) {
        console.error(`Realtime: a "${event}" handler on ${this.name} threw:`, err);
      }
    }
  }
}
