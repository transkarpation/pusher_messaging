import {
  INVITATION_ADDED_EVENT,
  INVITATION_REMOVED_EVENT,
  MESSAGE_CREATED_EVENT,
  MESSAGE_DELETED_EVENT,
  MESSAGE_UPDATED_EVENT,
  RECEIPT_UPDATED_EVENT,
  ROOM_ADDED_EVENT,
  ROOM_INVITES_EVENT,
  ROOM_MEMBERS_EVENT,
  ROOM_REMOVED_EVENT,
  USER_TYPING_EVENT,
  roomChannel,
  userChannel,
  type InvitationRemovedEvent,
  type Message,
  type Receipt,
  type RoomInvite,
  type RoomInvitesEvent,
  type RoomMember,
  type RoomMembersEvent,
  type RoomRemovedEvent,
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

  messageCreated(message: Message, except?: string) {
    this.realtime.publish(roomChannel(message.roomId), MESSAGE_CREATED_EVENT, message, except);
  }

  messageUpdated(message: Message, except?: string) {
    this.realtime.publish(roomChannel(message.roomId), MESSAGE_UPDATED_EVENT, message, except);
  }

  /** Carries the message with `deletedAt` set and empty `text`. */
  messageDeleted(message: Message, except?: string) {
    this.realtime.publish(roomChannel(message.roomId), MESSAGE_DELETED_EVENT, message, except);
  }

  receiptUpdated(receipt: Receipt, except?: string) {
    this.realtime.publish(roomChannel(receipt.roomId), RECEIPT_UPDATED_EVENT, receipt, except);
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
