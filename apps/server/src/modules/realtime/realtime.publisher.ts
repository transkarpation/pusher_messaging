import type { PresenceMember } from "@pm/shared";

/** Sends realtime events. Other modules depend on this interface, not on the transport. */
export interface RealtimePublisher {
  /**
   * Sends `event` to everyone subscribed to `channel`, except the connection `exceptSocketId`
   * (the one whose request caused it). Best-effort: failures are logged, never thrown.
   */
  publish(channel: string, event: string, data: unknown, exceptSocketId?: string): void;
}

/** Who is connected to the realtime server right now. */
export interface PresenceSource {
  /**
   * Which of `userIds` have an open connection (subscribed to their own user channel, which
   * every client keeps while it runs). Throws if the realtime server can't be asked.
   */
  onlineUserIds(userIds: number[]): Promise<Set<number>>;
}

/** What a granted subscription carries; the realtime server acts on it. */
export interface ChannelGrant {
  /** On a presence channel: the member the subscriber appears as. */
  presence?: PresenceMember;
  /**
   * On the user's own channel: the rooms they belong to. The channel forwards the activity topic
   * (`roomActivityTopic`) of each, and follows ROOM_ADDED_EVENT / ROOM_REMOVED_EVENT afterwards.
   */
  roomActivity?: number[];
}
