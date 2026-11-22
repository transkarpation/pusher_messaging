import type { PresenceMember } from "@pm/shared";

/** Sends realtime events. Other modules depend on this interface, not on the transport. */
export interface RealtimePublisher {
  /**
   * Sends `event` to everyone subscribed to `channel`, except the connection `exceptSocketId`
   * (the one whose request caused it). Best-effort: failures are logged, never thrown.
   */
  publish(channel: string, event: string, data: unknown, exceptSocketId?: string): void;
}

/** What a granted subscription carries: on a presence channel, the member the subscriber appears as. */
export interface ChannelGrant {
  presence?: PresenceMember;
}
