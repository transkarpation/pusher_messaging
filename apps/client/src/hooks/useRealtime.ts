import { useEffect } from "react";
import { MEMBER_ADDED, MEMBER_REMOVED, SUBSCRIBED, type Channel, type RealtimeClient } from "@pm/realtime-client";
import {
  BLOCKS_UPDATED_EVENT,
  MESSAGE_CREATED_EVENT,
  MESSAGE_DELETED_EVENT,
  MESSAGE_UPDATED_EVENT,
  INVITATION_ADDED_EVENT,
  INVITATION_REMOVED_EVENT,
  ONLINE_CHANNEL,
  RECEIPT_UPDATED_EVENT,
  ROOM_ADDED_EVENT,
  ROOM_INVITES_EVENT,
  ROOM_MEMBERS_EVENT,
  ROOM_REMOVED_EVENT,
  USER_TYPING_EVENT,
  USER_UPDATED_EVENT,
  roomChannel,
  userChannel,
  type BlocksEvent,
  type Invitation,
  type InvitationRemovedEvent,
  type Message,
  type PresenceMember,
  type Receipt,
  type Room,
  type RoomInvitesEvent,
  type RoomMembersEvent,
  type RoomRemovedEvent,
  type TypingEvent,
  type User,
} from "@pm/shared";
import { isWindowActive } from "../lib/activity";
import { getRealtime } from "../realtime";
import { useAuth } from "../store/auth";
import { useBlocks } from "../store/blocks";
import { useInvitations } from "../store/invitations";
import { useMessages } from "../store/messages";
import { useOnline } from "../store/online";
import { useRooms } from "../store/rooms";
import { useTyping } from "../store/typing";

type Handlers = Record<string, (data: never) => void>;

function bindAll(channel: Channel, handlers: Handlers) {
  for (const [event, handler] of Object.entries(handlers)) channel.bind(event, handler);
}

/**
 * Calls `resync` whenever the channel is subscribed again after a dropped connection
 * (the client resubscribes every channel on reconnect). Events sent while offline are
 * lost, so the state they would have changed has to be refetched; doing it once the
 * channel is live again means nothing published after the refetch can be missed.
 */
function onResubscribed(channel: Channel, resync: () => void) {
  let subscribed = false;
  channel.bind(SUBSCRIBED, () => {
    if (subscribed) resync();
    subscribed = true;
  });
}

/**
 * Wires all realtime channels into the stores:
 * - presence-online: who is online, profile updates
 * - private-user-{me}: being added to / removed from rooms, invitations, block list changes
 * - private-room-{id} for every room in the rooms store (kept in sync as it changes)
 *
 * After a reconnect, the room list and the messages of loaded rooms are refetched.
 */
export function useRealtime(me: User) {
  useEffect(() => {
    const rt: RealtimeClient = getRealtime();
    const roomChannels = new Map<number, Channel>();

    const rooms = useRooms.getState();
    const messages = useMessages.getState();
    const online = useOnline.getState();
    const typing = useTyping.getState();
    const invitations = useInvitations.getState();

    const roomHandlers = (roomId: number): Handlers => ({
      [MESSAGE_CREATED_EVENT]: (m: Message) => {
        typing.stop(roomId, m.author.id);
        messages.receive(m);
        const viewing = useRooms.getState().activeRoomId === roomId && isWindowActive();
        rooms.onMessage(m, { fromMe: m.author.id === me.id, viewing });
      },
      [MESSAGE_UPDATED_EVENT]: (m: Message) => messages.applyUpdate(m),
      [MESSAGE_DELETED_EVENT]: (m: Message) => messages.applyDelete(m, me.id),
      [USER_TYPING_EVENT]: (e: TypingEvent) => {
        if (e.typing) typing.start(roomId, e.userId);
        else typing.stop(roomId, e.userId);
      },
      [RECEIPT_UPDATED_EVENT]: (r: Receipt) => {
        messages.applyReceipt(r);
        if (r.userId === me.id) rooms.applyMyReceipt(r); // from another tab of mine
      },
      [ROOM_MEMBERS_EVENT]: (e: RoomMembersEvent) => rooms.setMembers(e.roomId, e.members),
      [ROOM_INVITES_EVENT]: (e: RoomInvitesEvent) => rooms.setInvites(e.roomId, e.invites),
    });

    /** Subscribes to rooms that appeared in the store, unsubscribes from those that left. */
    const syncRoomChannels = () => {
      const ids = new Set(Object.keys(useRooms.getState().rooms).map(Number));
      for (const id of ids) {
        if (roomChannels.has(id)) continue;
        const channel = rt.subscribe(roomChannel(id));
        bindAll(channel, roomHandlers(id));
        onResubscribed(channel, () => void messages.catchUp(id));
        roomChannels.set(id, channel);
      }
      for (const [id, channel] of roomChannels) {
        if (ids.has(id)) continue;
        channel.unbindAll();
        rt.unsubscribe(roomChannel(id));
        roomChannels.delete(id);
        messages.drop(id);
      }
    };

    bindAll(rt.subscribe(ONLINE_CHANNEL), {
      [SUBSCRIBED]: (members: PresenceMember[] | undefined) => online.setMembers(members ?? []),
      [MEMBER_ADDED]: (m: PresenceMember) => online.add(m),
      [MEMBER_REMOVED]: (m: PresenceMember) => online.remove(m),
      [USER_UPDATED_EVENT]: (u: User) => {
        online.update(u);
        rooms.updateUser(u);
        messages.updateAuthor(u);
        invitations.updateUser(u);
        useAuth.getState().applyUpdate(u);
      },
    } satisfies Handlers);

    const mine = rt.subscribe(userChannel(me.id));
    bindAll(mine, {
      [ROOM_ADDED_EVENT]: (room: Room) => rooms.upsert(room),
      [ROOM_REMOVED_EVENT]: (e: RoomRemovedEvent) => rooms.remove(e.roomId),
      [INVITATION_ADDED_EVENT]: (i: Invitation) => invitations.add(i),
      [INVITATION_REMOVED_EVENT]: (e: InvitationRemovedEvent) => invitations.remove(e.roomId),
      [BLOCKS_UPDATED_EVENT]: (e: BlocksEvent) => useBlocks.getState().set(e.blocked),
    } satisfies Handlers);
    // Rooms added/removed, last messages, unread counts, members and invitations changed while offline.
    onResubscribed(mine, () => {
      void rooms.fetch();
      void invitations.fetch();
      void useBlocks.getState().fetch();
    });

    syncRoomChannels();
    const unsubscribeStore = useRooms.subscribe((s, prev) => {
      if (s.rooms !== prev.rooms) syncRoomChannels();
    });

    return () => {
      unsubscribeStore();
      for (const name of [ONLINE_CHANNEL, userChannel(me.id), ...[...roomChannels.keys()].map(roomChannel)]) {
        rt.channel(name)?.unbindAll();
        rt.unsubscribe(name);
      }
      roomChannels.clear();
      online.reset();
      typing.reset();
    };
  }, [me.id]);
}
