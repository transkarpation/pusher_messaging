import { createApp } from "./app.js";
import { createContainer } from "./container.js";
import { redisReady } from "./shared/redis.js";

const container = createContainer();
// The rate limiters load their scripts into Redis when the app is built.
if (container.redis) await redisReady(container.redis);
const app = createApp(container);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(
    `Server listening on http://localhost:${port} (realtime: Phoenix at ${container.phoenix.config.url}, attachments: ${container.attachmentStorage}, rate limits: ${process.env.RATE_LIMITS === "off" ? "off" : container.redis ? "Redis" : "memory"})`,
  );
});
