/** Public surface of the realtime module. Other modules depend on `RealtimePublisher` only. */
export type { ChannelGrant, PresenceSource, RealtimePublisher } from "./realtime.publisher.js";
export { RealtimeService } from "./realtime.service.js";
export { realtimeRoutes } from "./realtime.routes.js";
export { phoenixConfigFromEnv } from "./realtime.config.js";
export { PhoenixGateway, type PhoenixConfig } from "./phoenix.gateway.js";
