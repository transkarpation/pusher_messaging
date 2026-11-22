import {
  CLOSE_PROTOCOL_ERROR,
  CLOSE_UNAUTHORIZED,
  type ClientFrame,
  type PresenceMember,
  type ServerFrame,
} from "@pm/shared";

/**
 * Client for the realtime WebSocket server (apps/server, realtime module). One instance
 * is one connection; it reconnects on its own and resubscribes every channel afterwards.
 * Works in browsers and React Native, which both have a global WebSocket.
 *
 *   const rt = new RealtimeClient({ url: "wss://chat.example.com/api/realtime/ws" });
 *   rt.subscribe("private-room-1").bind("message:created", (m: Message) => …);
 */

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

export interface SubscriptionError {
  status: number;
  error: string;
}

type Handler = (data: never) => void;

/** The constructor of a WebSocket implementation (the global one by default). */
type WebSocketCtor = new (url: string, protocols?: string | string[], options?: unknown) => WebSocket;

export interface RealtimeClientOptions {
  /** ws:// or wss:// address of the endpoint (REALTIME_PATH on the API server). */
  url: string;
  /**
   * Headers for the handshake, read on every (re)connect: `Authorization: Bearer …`.
   * Supported by React Native's WebSocket (and Node's `ws`), not by browsers, which send cookies instead.
   */
  headers?: () => Record<string, string>;
  /** WebSocket implementation; defaults to the global one. */
  WebSocket?: WebSocketCtor;
}

/** Quiet time after which the client pings the server. */
const PING_AFTER_MS = 25_000;
/** How long to wait for any frame after a ping before treating the connection as dead. */
const PONG_TIMEOUT_MS = 10_000;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

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

export class RealtimeClient {
  state: ConnectionState = "connecting";
  /** Id of the current connection; send it as `X-Socket-Id` so the server skips echoing your own events. */
  socketId: string | undefined;

  private readonly channels = new Map<string, Channel>();
  private readonly stateListeners = new Set<(state: ConnectionState) => void>();
  /**
   * Subscribes sent on this connection that have no reply yet, by channel name. Replies come
   * in order, so while more are outstanding a reply belongs to an earlier subscribe (one made
   * before an unsubscribe) and is ignored.
   */
  private readonly pendingSubscribes = new Map<string, number>();
  private readonly WebSocketImpl: WebSocketCtor;
  private ws: WebSocket | null = null;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setTimeout> | undefined;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: RealtimeClientOptions) {
    const impl = options.WebSocket ?? (globalThis.WebSocket as unknown as WebSocketCtor | undefined);
    if (!impl) throw new Error("No WebSocket implementation available");
    this.WebSocketImpl = impl;
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("online", this.onOnline);
    }
    this.open();
  }

  /** The channel `name`, subscribing to it if needed. Subscribing again returns the same channel. */
  subscribe(name: string): Channel {
    let channel = this.channels.get(name);
    if (channel) return channel;
    channel = new Channel(name);
    this.channels.set(name, channel);
    if (this.state === "connected") this.sendSubscribe(name);
    return channel;
  }

  /** Leaves the channel `name`. Its handlers stay bound to the old `Channel` object, which gets no more events. */
  unsubscribe(name: string) {
    const channel = this.channels.get(name);
    if (!channel) return;
    this.channels.delete(name);
    channel.subscribed = false;
    channel.members.clear();
    if (this.state === "connected") this.send({ type: "unsubscribe", channel: name });
  }

  channel(name: string): Channel | undefined {
    return this.channels.get(name);
  }

  /** Calls `listener` on every state change; returns a function that stops it. */
  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Retries right away when waiting to reconnect (e.g. the network is back). */
  reconnectNow() {
    if (this.state !== "unavailable") return;
    clearTimeout(this.retryTimer);
    this.open();
  }

  /** Closes the connection for good. */
  disconnect() {
    if (this.state === "closed") return;
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("online", this.onOnline);
    }
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.connectionLost();
    this.setState("closed");
    ws?.close(1000);
  }

  private readonly onOnline = () => this.reconnectNow();

  private open() {
    this.setState("connecting");
    let ws: WebSocket;
    try {
      const headers = this.options.headers?.();
      ws = headers ? new this.WebSocketImpl(this.options.url, undefined, { headers }) : new this.WebSocketImpl(this.options.url);
    } catch (err) {
      console.warn("Realtime: can't open a connection:", err);
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onmessage = (e) => this.onFrame(ws, e.data);
    ws.onclose = (e) => this.onClose(ws, e.code);
    ws.onerror = () => {}; // a close event follows
    this.armPing(ws);
  }

  private onFrame(ws: WebSocket, raw: unknown) {
    if (ws !== this.ws) return;
    this.armPing(ws);
    let frame: ServerFrame;
    try {
      frame = JSON.parse(String(raw));
    } catch {
      console.warn("Realtime: ignoring a malformed frame");
      return;
    }

    switch (frame.type) {
      case "connected":
        this.socketId = frame.socketId;
        this.attempts = 0;
        this.setState("connected");
        for (const name of this.channels.keys()) this.sendSubscribe(name);
        break;
      case "subscribed": {
        const channel = this.replyTarget(frame.channel);
        if (!channel) break;
        channel.subscribed = true;
        if (frame.members) {
          channel.members.clear();
          for (const m of frame.members) channel.members.set(m.id, m);
        }
        channel.emit(SUBSCRIBED, frame.members);
        break;
      }
      case "subscription_error": {
        const channel = this.replyTarget(frame.channel);
        if (!channel) break;
        console.warn(`Realtime: subscribing to ${frame.channel} failed (${frame.status}): ${frame.error}`);
        channel.emit(SUBSCRIPTION_ERROR, { status: frame.status, error: frame.error } satisfies SubscriptionError);
        break;
      }
      case "event":
        this.channels.get(frame.channel)?.emit(frame.event, frame.data);
        break;
      case "member_added": {
        const channel = this.channels.get(frame.channel);
        if (!channel?.subscribed) break;
        channel.members.set(frame.member.id, frame.member);
        channel.emit(MEMBER_ADDED, frame.member);
        break;
      }
      case "member_removed": {
        const channel = this.channels.get(frame.channel);
        if (!channel?.subscribed) break;
        channel.members.delete(frame.member.id);
        channel.emit(MEMBER_REMOVED, frame.member);
        break;
      }
      case "pong":
        break;
    }
  }

  /** The channel a subscribe reply is for, or undefined when it answers an earlier, abandoned subscribe. */
  private replyTarget(name: string): Channel | undefined {
    const left = (this.pendingSubscribes.get(name) ?? 1) - 1;
    if (left > 0) this.pendingSubscribes.set(name, left);
    else this.pendingSubscribes.delete(name);
    return left > 0 ? undefined : this.channels.get(name);
  }

  private onClose(ws: WebSocket, code: number) {
    if (ws !== this.ws) return;
    this.connectionLost();
    if (code === CLOSE_UNAUTHORIZED || code === CLOSE_PROTOCOL_ERROR) {
      console.warn(`Realtime: the server closed the connection (${code === CLOSE_UNAUTHORIZED ? "unauthorized" : "protocol error"})`);
      this.setState("closed");
      return;
    }
    this.scheduleRetry();
  }

  /** Forgets the current socket and everything tied to it. */
  private connectionLost() {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
    }
    this.socketId = undefined;
    this.pendingSubscribes.clear();
    clearTimeout(this.pingTimer);
    clearTimeout(this.pongTimer);
    for (const channel of this.channels.values()) {
      channel.subscribed = false;
      channel.members.clear();
    }
  }

  private scheduleRetry() {
    const base = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** this.attempts);
    const delay = base / 2 + Math.random() * (base / 2);
    this.attempts++;
    this.setState("unavailable");
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  /** After PING_AFTER_MS of silence, pings; with no frame PONG_TIMEOUT_MS later, drops the connection and reconnects. */
  private armPing(ws: WebSocket) {
    clearTimeout(this.pingTimer);
    clearTimeout(this.pongTimer);
    this.pingTimer = setTimeout(() => {
      if (this.state === "connected") this.send({ type: "ping" });
      this.pongTimer = setTimeout(() => {
        if (ws !== this.ws) return;
        ws.close();
        this.onClose(ws, 1006); // don't wait for a close handshake a dead connection can't finish
      }, PONG_TIMEOUT_MS);
    }, PING_AFTER_MS);
  }

  private sendSubscribe(name: string) {
    this.pendingSubscribes.set(name, (this.pendingSubscribes.get(name) ?? 0) + 1);
    this.send({ type: "subscribe", channel: name });
  }

  private send(frame: ClientFrame) {
    if (this.ws?.readyState === 1 /* OPEN */) this.ws.send(JSON.stringify(frame));
  }

  private setState(state: ConnectionState) {
    if (state === this.state) return;
    this.state = state;
    for (const listener of [...this.stateListeners]) listener(state);
  }
}

export type { PresenceMember };
