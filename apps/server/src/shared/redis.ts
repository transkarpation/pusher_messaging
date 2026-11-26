import { createClient } from "redis";

/**
 * A Redis client for REDIS_URL, or null when it isn't set. It connects in the background and
 * reconnects on its own. Commands sent while it's disconnected fail at once instead of waiting
 * in a queue, so callers (the rate limiter) can carry on without Redis.
 */
export function redisFromEnv() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: { reconnectStrategy: (retries) => Math.min(retries * 200, 5_000) },
  });
  // Logged once per outage, not on every reconnect attempt.
  let down = false;
  client.on("error", (err: Error) => {
    if (!down) console.error("Redis unavailable:", err.message);
    down = true;
  });
  client.on("ready", () => {
    if (down) console.log("Redis connected again");
    down = false;
  });
  client.connect().catch(() => undefined); // reported by the "error" listener
  return client;
}

export type RedisClient = NonNullable<ReturnType<typeof redisFromEnv>>;

/** Resolves once the client is connected, or after `timeoutMs` (it keeps trying after that). */
export const redisReady = (client: RedisClient, timeoutMs = 3_000): Promise<void> =>
  client.isReady
    ? Promise.resolve()
    : new Promise((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        client.once("ready", () => {
          clearTimeout(timer);
          resolve();
        });
      });
