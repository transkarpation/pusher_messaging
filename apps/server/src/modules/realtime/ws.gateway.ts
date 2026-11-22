import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { z } from "zod";
import {
  CLOSE_PROTOCOL_ERROR,
  CLOSE_UNAUTHORIZED,
  REALTIME_PATH,
  type PresenceMember,
  type ServerFrame,
  type User,
} from "@pm/shared";
import { AppError } from "../../shared/errors.js";
import type { ChannelGrant, RealtimePublisher } from "./realtime.publisher.js";

/** How the gateway learns who connects and what they may subscribe to. */
export interface GatewayHooks {
  /** The user behind a WebSocket upgrade request, or null to refuse it. */
  authenticate(req: IncomingMessage): Promise<User | null>;
  /** Grants a subscription, or throws (an `AppError` sends its status and message to the client). */
  authorize(user: User, channel: string): Promise<ChannelGrant>;
}

/** WebSocket-level ping interval; a connection that misses one pong is dropped. */
const HEARTBEAT_MS = 30_000;
/** Largest frame a client may send. Client frames are tiny; this only stops abuse. */
const MAX_CLIENT_FRAME_BYTES = 4 * 1024;
/** Channels one connection may be subscribed to at once. */
const MAX_CHANNELS_PER_CONNECTION = 1000;

const channelName = z.string().min(1).max(200);
const clientFrame = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscribe"), channel: channelName }),
  z.object({ type: z.literal("unsubscribe"), channel: channelName }),
  z.object({ type: z.literal("ping") }),
]);

class Connection {
  /** Subscribed channels and what each subscription was granted. */
  readonly channels = new Map<string, ChannelGrant>();
  alive = true;
  closed = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly id: string,
    readonly socket: WebSocket,
    readonly user: User,
  ) {}

  send(frame: ServerFrame) {
    this.sendRaw(JSON.stringify(frame));
  }

  sendRaw(payload: string) {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(payload);
  }

  /**
   * Runs subscription changes one at a time, in the order they arrived. Authorizing a
   * subscribe is async, so without this an unsubscribe sent right after it could be
   * handled first and leave the connection subscribed.
   */
  enqueue(task: () => Promise<void>) {
    this.queue = this.queue.then(task).catch((err) => console.error("Realtime: frame handling failed:", err));
  }
}

interface ChannelState {
  connections: Set<Connection>;
  /** Presence channels: each user on the channel, with how many of their connections are subscribed. */
  members: Map<string, { member: PresenceMember; connections: number }>;
}

/**
 * The realtime server: a WebSocket endpoint on the API's HTTP server that keeps
 * channel subscriptions in memory and fans published events out to them.
 *
 * State lives in this process only, so it serves a single server instance. Running
 * several would need a shared bus (e.g. Redis pub/sub) between them for `publish` and presence.
 */
export class WsGateway implements RealtimePublisher {
  private readonly connections = new Map<string, Connection>();
  private readonly channels = new Map<string, ChannelState>();
  private hooks: GatewayHooks | null = null;

  /** Starts accepting connections at REALTIME_PATH on `server`. */
  attach(server: Server, hooks: GatewayHooks) {
    this.hooks = hooks;
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_FRAME_BYTES });

    server.on("upgrade", (req, socket, head) => {
      const { pathname } = new URL(req.url ?? "/", "http://localhost");
      if (pathname !== REALTIME_PATH) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => void this.accept(ws, req));
    });

    const heartbeat = setInterval(() => {
      for (const conn of this.connections.values()) {
        if (!conn.alive) {
          conn.socket.terminate();
          continue;
        }
        conn.alive = false;
        conn.socket.ping();
      }
    }, HEARTBEAT_MS);
    server.on("close", () => {
      clearInterval(heartbeat);
      wss.close();
    });
  }

  publish(channel: string, event: string, data: unknown, exceptSocketId?: string) {
    try {
      this.broadcast(channel, { type: "event", channel, event, data }, exceptSocketId);
    } catch (err) {
      console.error(`Realtime: publishing "${event}" on ${channel} failed:`, err);
    }
  }

  private async accept(socket: WebSocket, req: IncomingMessage) {
    // Frames that arrive before the user is known are dropped; clients wait for `connected`.
    let user: User | null = null;
    try {
      user = await this.hooks!.authenticate(req);
    } catch (err) {
      console.error("Realtime: authenticating a connection failed:", err);
    }
    if (socket.readyState !== WebSocket.OPEN) return;
    if (!user) {
      socket.close(CLOSE_UNAUTHORIZED, "Unauthorized");
      return;
    }

    const conn = new Connection(randomUUID(), socket, user);
    this.connections.set(conn.id, conn);
    socket.on("message", (raw, isBinary) => this.onFrame(conn, raw, isBinary));
    socket.on("pong", () => {
      conn.alive = true;
    });
    socket.on("close", () => this.drop(conn));
    socket.on("error", (err) => console.warn(`Realtime: connection ${conn.id} error:`, err.message));
    conn.send({ type: "connected", socketId: conn.id });
  }

  private onFrame(conn: Connection, raw: RawData, isBinary: boolean) {
    conn.alive = true;
    let parsed: ReturnType<typeof clientFrame.safeParse> | null = null;
    if (!isBinary) {
      try {
        parsed = clientFrame.safeParse(JSON.parse(raw.toString()));
      } catch {
        // not JSON
      }
    }
    if (!parsed?.success) {
      conn.socket.close(CLOSE_PROTOCOL_ERROR, "Invalid frame");
      return;
    }

    const frame = parsed.data;
    switch (frame.type) {
      case "ping":
        conn.send({ type: "pong" });
        break;
      case "subscribe":
        conn.enqueue(() => this.subscribe(conn, frame.channel));
        break;
      case "unsubscribe":
        conn.enqueue(async () => this.leave(conn, frame.channel));
        break;
    }
  }

  private async subscribe(conn: Connection, channel: string) {
    if (conn.closed) return;
    const existing = conn.channels.get(channel);
    if (existing) {
      conn.send(this.subscribedFrame(channel, existing));
      return;
    }
    if (conn.channels.size >= MAX_CHANNELS_PER_CONNECTION) {
      conn.send({ type: "subscription_error", channel, status: 429, error: "Too many channels" });
      return;
    }

    let grant: ChannelGrant;
    try {
      grant = await this.hooks!.authorize(conn.user, channel);
    } catch (err) {
      if (!(err instanceof AppError)) console.error(`Realtime: authorizing ${channel} failed:`, err);
      const [status, error] = err instanceof AppError ? [err.status, err.message] : [500, "Internal server error"];
      conn.send({ type: "subscription_error", channel, status, error });
      return;
    }
    if (conn.closed) return; // closed while authorizing

    let state = this.channels.get(channel);
    if (!state) {
      state = { connections: new Set(), members: new Map() };
      this.channels.set(channel, state);
    }
    state.connections.add(conn);
    conn.channels.set(channel, grant);

    if (grant.presence) {
      const entry = state.members.get(grant.presence.id);
      if (entry) {
        entry.connections++;
      } else {
        state.members.set(grant.presence.id, { member: grant.presence, connections: 1 });
        this.broadcast(channel, { type: "member_added", channel, member: grant.presence }, conn.id);
      }
    }
    conn.send(this.subscribedFrame(channel, grant));
  }

  /** The reply to a granted subscribe; on a presence channel, with everyone on it (the subscriber included). */
  private subscribedFrame(channel: string, grant: ChannelGrant): ServerFrame {
    const members = grant.presence ? this.channels.get(channel)?.members : undefined;
    return { type: "subscribed", channel, members: members && [...members.values()].map((e) => e.member) };
  }

  private leave(conn: Connection, channel: string) {
    const grant = conn.channels.get(channel);
    const state = this.channels.get(channel);
    if (!grant || !state) return;
    conn.channels.delete(channel);
    state.connections.delete(conn);

    if (grant.presence) {
      const entry = state.members.get(grant.presence.id);
      if (entry && --entry.connections === 0) {
        state.members.delete(grant.presence.id);
        this.broadcast(channel, { type: "member_removed", channel, member: entry.member });
      }
    }
    if (state.connections.size === 0) this.channels.delete(channel);
  }

  private drop(conn: Connection) {
    if (conn.closed) return;
    conn.closed = true;
    for (const channel of [...conn.channels.keys()]) this.leave(conn, channel);
    this.connections.delete(conn.id);
  }

  /** Sends `frame` to every connection on `channel` except `exceptSocketId`; serialized once. */
  private broadcast(channel: string, frame: ServerFrame, exceptSocketId?: string) {
    const state = this.channels.get(channel);
    if (!state) return;
    const payload = JSON.stringify(frame);
    for (const conn of state.connections) {
      if (conn.id !== exceptSocketId) conn.sendRaw(payload);
    }
  }
}
