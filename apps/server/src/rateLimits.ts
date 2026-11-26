import type { Express, Request, RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import type { RedisClient } from "./shared/redis.js";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** Who a limit counts: the client's IP, or the signed-in user (their IP when signed out). */
type Key = "ip" | "user" | ((req: Request) => string);

interface Limit {
  /** Names the counters (Redis keys `rl:{name}:…`); routes with the same limit share them. */
  name: string;
  windowMs: number;
  max: number;
  key: Key;
  /** Count only failed requests (status >= 400), e.g. wrong passwords. */
  onlyFailures?: boolean;
  /** Over the limit, answer 204 as if done instead of 429 (for requests clients don't wait on). */
  dropSilently?: boolean;
}

const ipOf = (req: Request) => ipKeyGenerator(req.ip ?? "");
const keyOf = (key: Key, req: Request) =>
  key === "ip" ? ipOf(req) : key === "user" ? (req.user ? `u${req.user.id}` : ipOf(req)) : key(req);

/**
 * Rate limits of the HTTP API, by route. Counters are kept in Redis when REDIS_URL is set
 * (shared by all API processes), else in this process's memory. While Redis is down, requests
 * go through unlimited rather than fail (the outage is logged once, by the Redis client).
 * RATE_LIMITS=off turns them all off.
 */
export function applyRateLimits(app: Express, redis: RedisClient | null) {
  if (process.env.RATE_LIMITS === "off") return;

  const limiter = (limit: Limit): RequestHandler =>
    rateLimit({
      windowMs: limit.windowMs,
      limit: limit.max,
      keyGenerator: (req) => keyOf(limit.key, req),
      skipSuccessfulRequests: limit.onlyFailures ?? false,
      standardHeaders: "draft-8",
      identifier: limit.name,
      legacyHeaders: false,
      passOnStoreError: true,
      skip: () => redis !== null && !redis.isReady,
      store: redis
        ? new RedisStore({ prefix: `rl:${limit.name}:`, sendCommand: (...args: string[]) => redis.sendCommand(args) })
        : undefined,
      handler: (req, res) => {
        if (limit.dropSilently) {
          res.status(204).end();
          return;
        }
        const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
        const seconds = resetTime ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / SECOND)) : undefined;
        if (seconds) res.set("Retry-After", String(seconds));
        const wait = !seconds ? " later" : seconds < 60 ? ` in ${seconds} s` : ` in ${Math.ceil(seconds / 60)} min`;
        res.status(429).json({ error: `Too many requests. Try again${wait}.` });
      },
    });

  // Guessing passwords: wrong ones per account and IP, and all attempts per IP.
  app.post(
    "/api/auth/login",
    limiter({
      name: "login",
      windowMs: 15 * MINUTE,
      max: 10,
      onlyFailures: true,
      key: (req) => `${ipOf(req)}:${String(req.body?.username ?? "").toLowerCase()}`,
    }),
    limiter({ name: "login-ip", windowMs: 15 * MINUTE, max: 100, key: "ip" }),
  );
  app.post("/api/auth/register", limiter({ name: "register", windowMs: HOUR, max: 10, key: "ip" }));

  // Posting to rooms: messages, polls, poll options and comments share one budget.
  const posting = limiter({ name: "posting", windowMs: 10 * SECOND, max: 20, key: "user" });
  app.post(
    [
      "/api/rooms/:roomId/messages",
      "/api/rooms/:roomId/polls",
      "/api/rooms/:roomId/polls/:messageId/options",
      "/api/rooms/:roomId/polls/:messageId/comments",
    ],
    posting,
  );
  app.patch("/api/rooms/:roomId/messages/:messageId", limiter({ name: "editing", windowMs: 10 * SECOND, max: 20, key: "user" }));
  // Clients send it at most every 2 s; extra ones are dropped without an error.
  app.post(
    "/api/rooms/:roomId/typing",
    limiter({ name: "typing", windowMs: SECOND, max: 1, dropSilently: true, key: (req) => `u${req.user?.id}:${req.params.roomId}` }),
  );

  // Uploads: attachment files, and pictures (avatars, rooms created or edited with one).
  app.post("/api/rooms/:roomId/attachments", limiter({ name: "uploads", windowMs: MINUTE, max: 20, key: "user" }));
  const pictures = limiter({ name: "pictures", windowMs: 10 * MINUTE, max: 10, key: "user" });
  app.put("/api/auth/me/avatar", pictures);
  app.patch("/api/rooms/:roomId", pictures);
  app.post("/api/rooms", limiter({ name: "rooms", windowMs: HOUR, max: 30, key: "user" }));

  app.post("/api/rooms/:roomId/invites", limiter({ name: "invites", windowMs: HOUR, max: 50, key: "user" }));
  // Each change is announced to everyone online.
  app.put("/api/auth/me/privacy", limiter({ name: "privacy", windowMs: MINUTE, max: 10, key: "user" }));
  app.post("/api/push/subscriptions", limiter({ name: "push", windowMs: MINUTE, max: 10, key: "user" }));
  app.get("/api/realtime/phoenix/token", limiter({ name: "realtime-token", windowMs: MINUTE, max: 30, key: "user" }));
}
