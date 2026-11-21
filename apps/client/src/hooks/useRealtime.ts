import { useEffect } from "react";
import type Pusher from "pusher-js";
import type { Channel, Members } from "pusher-js";
import {
  MESSAGE_CREATED_EVENT,
  ONLINE_CHANNEL,
  RECEIPT_UPDATED_EVENT,
  ROOM_ADDED_EVENT,
  ROOM_MEMBERS_EVENT,
  ROOM_REMOVED_EVENT,
  USER_TYPING_EVENT,
  USER_UPDATED_EVENT,
  roomChannel,
  userChannel,
  type Message,
  type Receipt,
  type Room,
  type RoomMembersEvent,
  type RoomRemovedEvent,
  type TypingEvent,
  type User,
} from "@pm/shared";
import { isWindowActive } from "../lib/activity";
import { getPusher } from "../realtime";
import { useMessages } from "../store/messages";
import { useOnline, type PresenceMember } from "../store/online";
import { useRooms } from "../store/rooms";
import { useTyping } from "../store/typing";

type Handlers = Record<string, (data: never) => void>;

function bindAll(channel: Channel, handlers: Handlers) {
  for (const [event, handler] of Object.entries(handlers)) channel.bind(event, handler);
}

/**
 * Calls `resync` whenever the channel is subscribed again after a dropped connection
 * (pusher-js resubscribes every channel on reconnect). Events sent while offline are
 * lost, so the state they would have changed has to be refetched; doing it once the
 * channel is live again means nothing published after the refetch can be missed.
 */
function onResubscribed(channel: Channel, resync: () => void) {
  let subscribed = false;
  channel.bind("pusher:subscription_succeeded", () => {
    if (subscribed) resync();
    subscribed = true;
  });
}

/**
 * Wires all Pusher channels into the stores:
 * - presence-online: who is online, profile updates
 * - private-user-{me}: being added to / removed from rooms
 * - private-room-{id} for every room in the rooms store (kept in sync as it changes)
 *
 * After a reconnect, the room list and the messages of loaded rooms are refetched.
 */
export function useRealtime(me: User) {
  useEffect(() => {
    let cancelled = false;
    let pusher: Pusher | null = null;
    let unsubscribeStore: (() => void) | null = null;
    const roomChannels = new Map<number, Channel>();

    const rooms = useRooms.getState();
    const messages = useMessages.getState();
    const online = useOnline.getState();
    const typing = useTyping.getState();

    const roomHandlers = (roomId: number): Handlers => ({
      [MESSAGE_CREATED_EVENT]: (m: Message) => {
        typing.stop(roomId, m.author.id);
        messages.receive(m);
        const viewing = useRooms.getState().activeRoomId === roomId && isWindowActive();
        rooms.onMessage(m, { fromMe: m.author.id === me.id, viewing });
      },
      [USER_TYPING_EVENT]: (e: TypingEvent) => {
        if (e.typing) typing.start(roomId, e.userId);
        else typing.stop(roomId, e.userId);
      },
      [RECEIPT_UPDATED_EVENT]: (r: Receipt) => {
        messages.applyReceipt(r);
        if (r.userId === me.id) rooms.applyMyReceipt(r); // from another tab of mine
      },
      [ROOM_MEMBERS_EVENT]: (e: RoomMembersEvent) => rooms.setMembers(e.roomId, e.members),
    });

    /** Subscribes to rooms that appeared in the store, unsubscribes from those that left. */
    const syncRoomChannels = () => {
      if (!pusher) return;
      const ids = new Set(Object.keys(useRooms.getState().rooms).map(Number));
      for (const id of ids) {
        if (roomChannels.has(id)) continue;
        const channel = pusher.subscribe(roomChannel(id));
        bindAll(channel, roomHandlers(id));
        onResubscribed(channel, () => void messages.catchUp(id));
        roomChannels.set(id, channel);
      }
      for (const [id, channel] of roomChannels) {
        if (ids.has(id)) continue;
        channel.unbind_all();
        pusher.unsubscribe(roomChannel(id));
        roomChannels.delete(id);
        messages.drop(id);
      }
    };

    getPusher()
      .then((p) => {
        if (cancelled) return;
        pusher = p;

        bindAll(p.subscribe(ONLINE_CHANNEL), {
          "pusher:subscription_succeeded": (members: Members) => online.setMembers(members),
          "pusher:member_added": (m: PresenceMember) => online.add(m),
          "pusher:member_removed": (m: PresenceMember) => online.remove(m),
          [USER_UPDATED_EVENT]: (u: User) => {
            online.update(u);
            rooms.updateUser(u);
            messages.updateAuthor(u);
          },
        } satisfies Handlers);

        const mine = p.subscribe(userChannel(me.id));
        bindAll(mine, {
          [ROOM_ADDED_EVENT]: (room: Room) => rooms.upsert(room),
          [ROOM_REMOVED_EVENT]: (e: RoomRemovedEvent) => rooms.remove(e.roomId),
        } satisfies Handlers);
        // Rooms added/removed, last messages, unread counts and members changed while offline.
        onResubscribed(mine, () => void rooms.fetch());

        syncRoomChannels();
        unsubscribeStore = useRooms.subscribe((s, prev) => {
          if (s.rooms !== prev.rooms) syncRoomChannels();
        });
      })
      .catch((err) => console.error("Realtime unavailable:", err));

    return () => {
      cancelled = true;
      unsubscribeStore?.();
      if (pusher) {
        for (const name of [ONLINE_CHANNEL, userChannel(me.id), ...[...roomChannels.keys()].map(roomChannel)]) {
          pusher.channel(name)?.unbind_all();
          pusher.unsubscribe(name);
        }
      }
      roomChannels.clear();
      online.reset();
      typing.reset();
    };
  }, [me.id]);
}
