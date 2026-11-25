import { create } from "zustand";
import {
  ROOMS_MAX_PAGE_SIZE,
  ROOMS_PAGE_SIZE,
  isSystemMessage,
  type Message,
  type Receipt,
  type Room,
  type RoomActivityEvent,
  type RoomInvite,
  type RoomMember,
  type RoomUpdatedEvent,
  type User,
} from "@pm/shared";
import { ApiRequestError, api } from "../api";
import { latestVersion } from "../lib/messageVersion";
import { isBlocked } from "./blocks";

const ACTIVE_KEY = "pm.activeRoomId";

function readActive(): number | null {
  try {
    const v = Number(localStorage.getItem(ACTIVE_KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeActive(id: number | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, String(id));
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // storage unavailable: the active room just isn't remembered
  }
}

/** Most recently active rooms first: the order the server pages them in. */
export function sortRooms(rooms: Record<number, Room>): Room[] {
  return Object.values(rooms).sort((a, b) => b.activity - a.activity || b.id - a.id);
}

/** Rooms being fetched one by one because of activity in them (see `onActivity`). */
const fetchingRooms = new Set<number>();
/** Bumped by `fetch` and `reset`, so a page requested before them isn't merged after. */
let generation = 0;

/**
 * A refetched room, keeping what realtime events delivered while the request was
 * in flight: a newer last message (with its unread count) and further-moved watermarks.
 */
function keepNewer(fetched: Room, local: Room | undefined, trustServer: boolean): Room {
  if (!local) return fetched;
  const activity = Math.max(fetched.activity, local.activity);
  if (trustServer) {
    // Only the watermarks; last message and unread count are the server's.
    const myReceipt = {
      deliveredUpTo: Math.max(fetched.myReceipt.deliveredUpTo, local.myReceipt.deliveredUpTo),
      readUpTo: Math.max(fetched.myReceipt.readUpTo, local.myReceipt.readUpTo),
    };
    return { ...fetched, myReceipt, activity };
  }
  const localIsNewer =
    !!local.lastMessage && local.lastMessage.id > (fetched.lastMessage?.id ?? 0);
  // Same last message: keep whichever copy saw the later edit/deletion.
  const lastMessage =
    local.lastMessage && fetched.lastMessage && local.lastMessage.id === fetched.lastMessage.id
      ? latestVersion(local.lastMessage, fetched.lastMessage)
      : fetched.lastMessage;
  const myReceipt = {
    deliveredUpTo: Math.max(fetched.myReceipt.deliveredUpTo, local.myReceipt.deliveredUpTo),
    readUpTo: Math.max(fetched.myReceipt.readUpTo, local.myReceipt.readUpTo),
  };
  const room = localIsNewer
    ? { ...fetched, lastMessage: local.lastMessage, unreadCount: local.unreadCount, myReceipt, activity }
    : { ...fetched, lastMessage, myReceipt, activity };
  const caughtUp = myReceipt.readUpTo >= (room.lastMessage?.id ?? 0);
  return caughtUp ? { ...room, unreadCount: 0 } : room;
}

interface RoomsState {
  /**
   * The rooms loaded so far: the most recently active ones, page by page as the list is
   * scrolled (`fetchMore`), plus any that got a message or were joined since, and the active one.
   */
  rooms: Record<number, Room>;
  loaded: boolean;
  error: string | null;
  activeRoomId: number | null;
  /** Continues the list past the loaded pages; null when every room is loaded. */
  nextCursor: string | null;
  loadingMore: boolean;
  /**
   * Loads the first page of the room list, or as many rooms as are loaded already (up to
   * ROOMS_MAX_PAGE_SIZE) when refreshing, and replaces the list with them. With `trustServer`,
   * last messages and unread counts are taken as fetched even if they look older than ours
   * (after blocking someone they are).
   */
  fetch: (opts?: { trustServer?: boolean }) => Promise<void>;
  /** Loads the next page of rooms, if there is one. */
  fetchMore: () => Promise<void>;
  /**
   * A new message in one of the user's rooms (ROOM_ACTIVITY_EVENT): moves the room up and updates
   * its preview and unread count, or fetches the room if it isn't loaded.
   */
  onActivity: (event: RoomActivityEvent, opts: { fromMe: boolean; viewing: boolean }) => void;
  upsert: (room: Room) => void;
  remove: (roomId: number) => void;
  setActive: (roomId: number | null) => void;
  setMembers: (roomId: number, members: RoomMember[]) => void;
  setInvites: (roomId: number, invites: RoomInvite[]) => void;
  /** The room's new name and picture, after the owner changed them. */
  setDetails: (event: RoomUpdatedEvent) => void;
  /** Updates last message and unread count (regular messages only) for a new message in a room. */
  onMessage: (message: Message, opts: { fromMe: boolean; viewing: boolean }) => void;
  /** Refreshes the last message if it is the one that was edited. */
  onMessageUpdated: (message: Message) => void;
  /** Marks the last message deleted if it's that one, and drops it from the unread count. */
  onMessageDeleted: (message: Message, opts: { fromMe: boolean }) => void;
  /** Applies the current user's own receipt (clears unread once read up to the latest). */
  applyMyReceipt: (receipt: Receipt) => void;
  updateUser: (user: User) => void;
  reset: () => void;
}

export const useRooms = create<RoomsState>((set, get) => ({
  rooms: {},
  loaded: false,
  error: null,
  activeRoomId: readActive(),

  nextCursor: null,
  loadingMore: false,

  fetch: async ({ trustServer = false } = {}) => {
    const gen = ++generation;
    try {
      const loadedCount = Object.keys(get().rooms).length;
      const limit = Math.min(Math.max(loadedCount, ROOMS_PAGE_SIZE), ROOMS_MAX_PAGE_SIZE);
      const page = await api.getRooms({ limit });
      // The remembered room may be further down the list than this page.
      const wanted = get().activeRoomId;
      const active = wanted && !page.rooms.some((r) => r.id === wanted) ? await fetchRoom(wanted).catch(() => null) : null;
      if (gen !== generation) return; // reset or refetched meanwhile
      const { rooms: prev, activeRoomId } = get();
      const list = active ? [...page.rooms, active] : page.rooms;
      const rooms = Object.fromEntries(list.map((r) => [r.id, keepNewer(r, prev[r.id], trustServer)]));
      const activeId =
        activeRoomId && rooms[activeRoomId] ? activeRoomId : (sortRooms(rooms)[0]?.id ?? null);
      writeActive(activeId);
      set({ rooms, loaded: true, error: null, activeRoomId: activeId, nextCursor: page.nextCursor });
    } catch (e) {
      // A failed refresh (e.g. after a reconnect) keeps the list we already have.
      if (get().loaded && !get().error) console.warn("Refreshing rooms failed:", e);
      else set({ loaded: true, error: (e as Error).message });
    }
  },

  fetchMore: async () => {
    const { nextCursor: cursor, loadingMore, loaded } = get();
    if (!cursor || loadingMore || !loaded) return;
    const gen = generation;
    set({ loadingMore: true });
    try {
      const page = await api.getRooms({ before: cursor });
      if (gen !== generation) return; // the list was replaced meanwhile
      set((s) => {
        const rooms = { ...s.rooms };
        for (const r of page.rooms) rooms[r.id] = keepNewer(r, s.rooms[r.id], false);
        return { rooms, nextCursor: s.nextCursor === cursor ? page.nextCursor : s.nextCursor };
      });
    } catch (e) {
      console.warn("Loading more rooms failed:", e);
    } finally {
      if (gen === generation) set({ loadingMore: false });
    }
  },

  onActivity: ({ roomId, message }, opts) => {
    if (!get().rooms[roomId]) {
      // Not loaded (further down the list): now it's at the top, so fetch it.
      if (fetchingRooms.has(roomId)) return;
      fetchingRooms.add(roomId);
      const gen = generation;
      void fetchRoom(roomId)
        .then((room) => {
          if (!room || gen !== generation) return;
          set((s) => ({ rooms: { ...s.rooms, [roomId]: keepNewer(room, s.rooms[roomId], false) } }));
        })
        .catch((e) => console.warn(`Loading room ${roomId} failed:`, e))
        .finally(() => fetchingRooms.delete(roomId));
      return;
    }
    get().onMessage(message, opts);
  },

  upsert: (room) => set((s) => ({ rooms: { ...s.rooms, [room.id]: room } })),

  remove: (roomId) =>
    set((s) => {
      if (!s.rooms[roomId]) return s;
      const { [roomId]: _, ...rooms } = s.rooms;
      const activeRoomId =
        s.activeRoomId === roomId ? (sortRooms(rooms)[0]?.id ?? null) : s.activeRoomId;
      writeActive(activeRoomId);
      return { rooms, activeRoomId };
    }),

  setActive: (roomId) => {
    writeActive(roomId);
    set({ activeRoomId: roomId });
  },

  setDetails: ({ roomId, name, avatarUrl }) =>
    set((s) => {
      const room = s.rooms[roomId];
      return room ? { rooms: { ...s.rooms, [roomId]: { ...room, name, avatarUrl } } } : s;
    }),

  setMembers: (roomId, members) =>
    set((s) => {
      const room = s.rooms[roomId];
      return room ? { rooms: { ...s.rooms, [roomId]: { ...room, members } } } : s;
    }),

  setInvites: (roomId, invites) =>
    set((s) => {
      const room = s.rooms[roomId];
      return room ? { rooms: { ...s.rooms, [roomId]: { ...room, invites } } } : s;
    }),

  onMessage: (message, { fromMe, viewing }) =>
    set((s) => {
      const found = s.rooms[message.roomId];
      if (!found) return s;
      // Any message moves the room up, the same as on the server.
      const room = { ...found, activity: Math.max(found.activity, Date.parse(message.createdAt)) };
      // Messages of blocked users don't show up in the preview or the unread count.
      if (!isSystemMessage(message) && isBlocked(message.author.id)) {
        return room.activity === found.activity ? s : { rooms: { ...s.rooms, [room.id]: room } };
      }
      const isNewer = !room.lastMessage || message.id > room.lastMessage.id;
      return {
        rooms: {
          ...s.rooms,
          [room.id]: {
            ...room,
            lastMessage: isNewer ? message : room.lastMessage,
            unreadCount:
              room.unreadCount + (isNewer && !fromMe && !viewing && !isSystemMessage(message) ? 1 : 0),
          },
        },
      };
    }),

  onMessageUpdated: (message) =>
    set((s) => {
      const room = s.rooms[message.roomId];
      if (!room?.lastMessage || room.lastMessage.id !== message.id) return s;
      const lastMessage = latestVersion(room.lastMessage, message);
      return { rooms: { ...s.rooms, [room.id]: { ...room, lastMessage } } };
    }),

  onMessageDeleted: (message, { fromMe }) =>
    set((s) => {
      const room = s.rooms[message.roomId];
      if (!room || isBlocked(message.author.id)) return s; // never counted, never the preview
      const wasUnread = !fromMe && message.id > room.myReceipt.readUpTo;
      const lastMessage =
        room.lastMessage?.id === message.id ? latestVersion(room.lastMessage, message) : room.lastMessage;
      const unreadCount = Math.max(0, room.unreadCount - (wasUnread ? 1 : 0));
      return { rooms: { ...s.rooms, [room.id]: { ...room, lastMessage, unreadCount } } };
    }),

  applyMyReceipt: (r) =>
    set((s) => {
      const room = s.rooms[r.roomId];
      if (!room) return s;
      const myReceipt = {
        deliveredUpTo: Math.max(room.myReceipt.deliveredUpTo, r.deliveredUpTo),
        readUpTo: Math.max(room.myReceipt.readUpTo, r.readUpTo),
      };
      const caughtUp = myReceipt.readUpTo >= (room.lastMessage?.id ?? 0);
      return {
        rooms: {
          ...s.rooms,
          [room.id]: { ...room, myReceipt, unreadCount: caughtUp ? 0 : room.unreadCount },
        },
      };
    }),

  updateUser: (user) =>
    set((s) => {
      const rooms: Record<number, Room> = {};
      for (const room of Object.values(s.rooms)) {
        rooms[room.id] = {
          ...room,
          members: room.members.map((m) => (m.user.id === user.id ? { ...m, user } : m)),
          invites: room.invites.map((i) => ({
            ...i,
            user: i.user.id === user.id ? user : i.user,
            invitedBy: i.invitedBy?.id === user.id ? user : i.invitedBy,
          })),
          lastMessage:
            room.lastMessage?.author.id === user.id
              ? { ...room.lastMessage, author: user }
              : room.lastMessage,
        };
      }
      return { rooms };
    }),

  reset: () => {
    generation++;
    set({ rooms: {}, loaded: false, error: null, nextCursor: null, loadingMore: false });
  },
}));

/** The room, or null if the user can't see it (anymore). */
async function fetchRoom(roomId: number): Promise<Room | null> {
  try {
    return await api.getRoom(roomId);
  } catch (e) {
    if (e instanceof ApiRequestError && (e.status === 403 || e.status === 404)) return null;
    throw e;
  }
}
