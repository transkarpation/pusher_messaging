import {
  INVITATION_ADDED_EVENT,
  INVITATION_REMOVED_EVENT,
  MESSAGE_CREATED_EVENT,
  MESSAGE_DELETED_EVENT,
  MESSAGE_UPDATED_EVENT,
  POLL_UPDATED_EVENT,
  POLL_VOTED_EVENT,
  RECEIPT_UPDATED_EVENT,
  ROOM_ACTIVITY_EVENT,
  ROOM_ADDED_EVENT,
  ROOM_INVITES_EVENT,
  ROOM_MEMBERS_EVENT,
  ROOM_PINNED_EVENT,
  ROOM_REMOVED_EVENT,
  ROOM_UPDATED_EVENT,
  USER_TYPING_EVENT,
  roomActivityTopic,
  roomChannel,
  userChannel,
  type InvitationRemovedEvent,
  type Message,
  type PollUpdatedEvent,
  type PollVotedEvent,
  type Receipt,
  type RoomActivityEvent,
  type RoomInvite,
  type RoomInvitesEvent,
  type RoomMember,
  type RoomMembersEvent,
  type RoomPinnedEvent,
  type RoomRemovedEvent,
  type RoomUpdatedEvent,
  type TypingEvent,
} from "@pm/shared";
import type { RealtimePublisher } from "../realtime/index.js";
import type { ChatViews } from "./chat.views.js";

/**
 * The chat's realtime events: which event goes to which channel, in one place.
 * `except` is the socket id of the connection whose request caused the event.
 */
export class ChatEvents {
  constructor(
    private readonly realtime: RealtimePublisher,
    private readonly views: ChatViews,
  ) {}

  /**
   * The message to the room's channel, and ROOM_ACTIVITY_EVENT to the room's activity topic, which
   * the realtime server forwards to each member's user channel (also for rooms a client hasn't loaded).
   */
  messageCreated(message: Message, except?: string) {
    this.realtime.publish(roomChannel(message.roomId), MESSAGE_CREATED_EVENT, message, except);
    const activity: RoomActivityEvent = { roomId: message.roomId, message };
    this.realtime.publish(roomActivityTopic(message.roomId), ROOM_ACTIVITY_EVENT, activity, except);
  }

  messageUpdated(message: Message, except?: string) {
    this.realtime.publish(roomChannel(message.roomId), MESSAGE_UPDATED_EVENT, message, except);
  }

  /** Carries the message with `deletedAt` set and empty `text`. */
  messageDeleted(message: Message, except?: string) {
    this.realtime.publish(roomChannel(message.roomId), MESSAGE_DELETED_EVENT, message, except);
  }

  /** A poll's new state, the same for everyone in the room. */
  pollUpdated(event: PollUpdatedEvent, except?: string) {
    this.realtime.publish(roomChannel(event.roomId), POLL_UPDATED_EVENT, event, except);
  }

  /** The user's own vote, for their other tabs. */
  pollVoted(userId: number, event: PollVotedEvent, except?: string) {
    this.realtime.publish(userChannel(userId), POLL_VOTED_EVENT, event, except);
  }

  receiptUpdated(receipt: Receipt, except?: string) {
    this.realtime.publish(roomChannel(receipt.roomId), RECEIPT_UPDATED_EVENT, receipt, except);
  }

  roomUpdated(event: RoomUpdatedEvent, except?: string) {
    this.realtime.publish(roomChannel(event.roomId), ROOM_UPDATED_EVENT, event, except);
  }

  typing(event: TypingEvent, except?: string) {
    this.realtime.publish(roomChannel(event.roomId), USER_TYPING_EVENT, event, except);
  }

  /** Sends the room's members (loaded now unless given); returns them. */
  async membersChanged(roomId: number, except?: string, members?: RoomMember[]): Promise<RoomMember[]> {
    const event: RoomMembersEvent = { roomId, members: members ?? (await this.views.members(roomId)) };
    this.realtime.publish(roomChannel(roomId), ROOM_MEMBERS_EVENT, event, except);
    return event.members;
  }

  /** Sends the room's pending invites to its members; returns them. */
  async invitesChanged(roomId: number, except?: string): Promise<RoomInvite[]> {
    const event: RoomInvitesEvent = { roomId, invites: await this.views.roomInvites(roomId) };
    this.realtime.publish(roomChannel(roomId), ROOM_INVITES_EVENT, event, except);
    return event.invites;
  }

  /** In the background: each newly invited user gets the invitation on their own channel. */
  invitationsAdded(roomId: number, userIds: number[]) {
    background(
      "invitationsAdded",
      Promise.all(
        userIds.map(async (uid) => {
          const [invitation] = await this.views.invitationsFor(uid, [roomId]);
          if (invitation) this.realtime.publish(userChannel(uid), INVITATION_ADDED_EVENT, invitation);
        }),
      ),
    );
  }

  /** Tells the user (all their tabs) that an invitation is gone. */
  invitationRemoved(userId: number, roomId: number, except?: string) {
    const event: InvitationRemovedEvent = { roomId };
    this.realtime.publish(userChannel(userId), INVITATION_REMOVED_EVENT, event, except);
  }

  /** In the background: each user gets the room (as they see it) on their own channel. */
  roomAdded(roomId: number, userIds: number[]) {
    background(
      "roomAdded",
      Promise.all(
        userIds.map(async (uid) => {
          const [room] = await this.views.roomsFor(uid, [roomId]);
          if (room) this.realtime.publish(userChannel(uid), ROOM_ADDED_EVENT, room);
        }),
      ),
    );
  }

  /** The user's other tabs and devices move the room in or out of their pinned rooms. */
  roomPinned(userId: number, event: RoomPinnedEvent, except?: string) {
    this.realtime.publish(userChannel(userId), ROOM_PINNED_EVENT, event, except);
  }

  roomRemoved(userId: number, roomId: number) {
    const event: RoomRemovedEvent = { roomId };
    this.realtime.publish(userChannel(userId), ROOM_REMOVED_EVENT, event);
  }

  /** `invitesChanged` without waiting for it (after the response matters more). */
  invitesChangedLater(roomId: number) {
    background("invitesChanged", this.invitesChanged(roomId));
  }
}

const background = (what: string, work: Promise<unknown>) =>
  void work.catch((err) => console.error(`${what} failed:`, err));
