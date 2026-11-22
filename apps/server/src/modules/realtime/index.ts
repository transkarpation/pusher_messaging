/** Public surface of the realtime module. Other modules depend on `RealtimePublisher` only. */
export type { ChannelGrant, RealtimePublisher } from "./realtime.publisher.js";
export { RealtimeService } from "./realtime.service.js";
export { WsGateway, type GatewayHooks } from "./ws.gateway.js";
