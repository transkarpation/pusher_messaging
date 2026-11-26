import { createHmac, timingSafeEqual } from "node:crypto";
import type { PresenceSource, RealtimePublisher } from "./realtime.publisher.js";

export interface PhoenixConfig {
  /** Where this server reaches the Phoenix server, e.g. http://localhost:4000. */
  url: string;
  /** The phoenix.js endpoint clients connect to, e.g. ws://localhost:4000/socket. */
  socketUrl: string;
  /** Shared with the Phoenix server (PHOENIX_SHARED_SECRET on both sides). */
  secret: string;
}

/** How long a connection token is valid. Clients fetch a new one well before that. */
const TOKEN_TTL_SECONDS = 15 * 60;
const PUBLISH_TIMEOUT_MS = 5_000;

/**
 * Realtime through the Phoenix server in apps/realtime-server-phoenix:
 * - publishes with `POST {url}/api/broadcast`, authenticated with the shared secret;
 * - asks who is connected with `POST {url}/api/presence/online`;
 * - issues the tokens clients connect with, which Phoenix verifies on its own;
 * - recognizes Phoenix's calls to `POST /api/realtime/phoenix/authorize` by the same secret.
 */
export class PhoenixGateway implements RealtimePublisher, PresenceSource {
  constructor(readonly config: PhoenixConfig) {}

  publish(channel: string, event: string, data: unknown, exceptSocketId?: string) {
    fetch(`${this.config.url}/api/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.secret}` },
      body: JSON.stringify({ channel, event, data, exceptSocketId }),
      signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
    })
      .then((res) => {
        if (!res.ok) console.error(`Phoenix broadcast "${event}" on ${channel} failed: HTTP ${res.status}`);
      })
      .catch((err) => console.error(`Phoenix broadcast "${event}" on ${channel} failed:`, err));
  }

  async onlineUserIds(userIds: number[]): Promise<Set<number>> {
    if (userIds.length === 0) return new Set();
    const res = await fetch(`${this.config.url}/api/presence/online`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.secret}` },
      body: JSON.stringify({ userIds }),
      signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Phoenix presence lookup failed: HTTP ${res.status}`);
    const { online } = (await res.json()) as { online: number[] };
    return new Set(online);
  }

  /**
   * A connection token for `userId`: base64url JSON `{ sub, exp }`, a dot, and its
   * HMAC-SHA256 with the shared secret (RealtimeServer.Token on the Phoenix side).
   */
  issueToken(userId: number, now = Date.now()): { token: string; expiresAt: Date } {
    const exp = Math.floor(now / 1000) + TOKEN_TTL_SECONDS;
    const payload = Buffer.from(JSON.stringify({ sub: userId, exp })).toString("base64url");
    const signature = createHmac("sha256", this.config.secret).update(payload).digest("base64url");
    return { token: `${payload}.${signature}`, expiresAt: new Date(exp * 1000) };
  }

  /** Whether an `Authorization` header carries the shared secret (a request from the Phoenix server). */
  isPhoenix(authorization: string | undefined): boolean {
    const given = Buffer.from(authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "");
    const expected = Buffer.from(this.config.secret);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}
