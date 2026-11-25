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

/** Which rooms the room list shows: all of them, or only those with unread messages. */
export type RoomFilter = "all" | "unread";

/** Paging through one filter's list (GET /api/rooms, with `unread=1` for "unread"). */
export interface RoomList {
  /** Whether its first page was loaded. */
  loaded: boolean;
  /** Continues it past the loaded pages; null when it's all loaded. */
  cursor: string | null;
}

const NOT_LOADED: RoomList = { loaded: false, cursor: null };

/** Whether `room` lies within what `list` has paged through (rooms past its cursor aren't loaded in order yet). */
function withinList(room: Room, list: RoomList): boolean {
  if (!list.cursor) return list.loaded;
  const [activity, id] = list.cursor.split(".").map(Number) as [number, number];
  return room.activity > activity || (room.activity === activity && room.id >= id);
}

/**
 * The rooms the list shows for `filter`, most recently active first: the loaded rooms up to where
 * that filter's paging got (further ones would show up out of order), and for "unread" only rooms
 * with unread messages, plus `kept` (rooms read while the filter is on stay until it's switched off).
 */
export function visibleRooms(
  rooms: Record<number, Room>,
  list: RoomList,
  filter: RoomFilter,
  kept: ReadonlySet<number> = new Set(),
): Room[] {
  return sortRooms(rooms).filter(
    (r) => withinList(r, list) && (filter === "all" || r.unreadCount > 0 || kept.has(r.id)),
  );
}

/**
 * How many rooms have unread messages: the loaded ones by their `unreadCount` (kept current by
 * realtime events), the others by the server's list from the last refresh.
 */
export function unreadRoomCount(s: Pick<RoomsState, "rooms" | "unreadElsewhere">): number {
  let count = 0;
  for (const room of Object.values(s.rooms)) if (room.unreadCount > 0) count++;
  for (const id of s.unreadElsewhere) if (!s.rooms[id]) count++;
  return count;
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
  /**
   * Rooms with unread messages per the server at the last refresh (GET /api/rooms/unread). Only
   * consulted for rooms that aren't loaded; see `unreadRoomCount`.
   */
  unreadElsewhere: number[];
  /** The filter the room list shows. */
  filter: RoomFilter;
  /** How far each filter's list is paged; both share `rooms`. */
  lists: Record<RoomFilter, RoomList>;
  loadingMore: boolean;
  /**
   * Loads the first page of the room list, or as many rooms as are loaded already (up to
   * ROOMS_MAX_PAGE_SIZE) when refreshing, and replaces the rooms with them; the unread list too,
   * if it was opened or is on. With `trustServer`, last messages and unread counts are taken as fetched
   * even if they look older than ours (after blocking someone they are).
   */
  fetch: (opts?: { trustServer?: boolean }) => Promise<void>;
  /** Loads the next page of the current filter's list, if there is one. */
  fetchMore: () => Promise<void>;
  /** Switches the filter, loading its first page the first time. */
  setFilter: (filter: RoomFilter) => void;
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

  unreadElsewhere: [],
  filter: "all",
  lists: { all: NOT_LOADED, unread: NOT_LOADED },
  loadingMore: false,

  fetch: async ({ trustServer = false } = {}) => {
    const gen = ++generation;
    try {
      const { rooms: current, lists, filter } = get();
      const withUnread = lists.unread.loaded || filter === "unread";
      const limitFor = (filter: RoomFilter) => {
        const shown = visibleRooms(current, lists[filter], filter).length;
        return Math.min(Math.max(shown, ROOMS_PAGE_SIZE), ROOMS_MAX_PAGE_SIZE);
      };
      const [page, unreadPage, unreadIds] = await Promise.all([
        api.getRooms({ limit: limitFor("all") }),
        withUnread ? api.getRooms({ limit: limitFor("unread"), unread: true }) : null,
        // Only for the count; a failure just leaves it to the loaded rooms.
        api.getUnreadRoomIds().catch(() => null),
      ]);
      const fetched = [...page.rooms, ...(unreadPage?.rooms ?? [])];
      // The remembered room may be further down the list than these pages.
      const wanted = get().activeRoomId;
      const active = wanted && !fetched.some((r) => r.id === wanted) ? await fetchRoom(wanted).catch(() => null) : null;
      if (gen !== generation) return; // reset or refetched meanwhile
      const { rooms: prev, activeRoomId } = get();
      if (active) fetched.push(active);
      const rooms = Object.fromEntries(fetched.map((r) => [r.id, keepNewer(r, prev[r.id], trustServer)]));
      const activeId =
        activeRoomId && rooms[activeRoomId] ? activeRoomId : (sortRooms(rooms)[0]?.id ?? null);
      writeActive(activeId);
      set({
        rooms,
        ...(unreadIds ? { unreadElsewhere: unreadIds.roomIds } : {}),
        loaded: true,
        error: null,
        activeRoomId: activeId,
        lists: {
          all: { loaded: true, cursor: page.nextCursor },
          unread: unreadPage ? { loaded: true, cursor: unreadPage.nextCursor } : NOT_LOADED,
        },
      });
    } catch (e) {
      // A failed refresh (e.g. after a reconnect) keeps the list we already have.
      if (get().loaded && !get().error) console.warn("Refreshing rooms failed:", e);
      else set({ loaded: true, error: (e as Error).message });
    }
  },

  fetchMore: async () => {
    const { filter, lists, loadingMore, loaded } = get();
    const list = lists[filter];
    // A list's first page comes from `fetch` / `setFilter`; this only continues it.
    if (!loaded || loadingMore || !list.loaded || !list.cursor) return;
    await loadPage(filter, list.cursor);
  },

  setFilter: (filter) => {
    set({ filter });
    if (!get().lists[filter].loaded && get().loaded) void loadPage(filter, undefined);
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
      const unreadElsewhere = s.unreadElsewhere.filter((id) => id !== roomId);
      if (!s.rooms[roomId]) return unreadElsewhere.length === s.unreadElsewhere.length ? s : { unreadElsewhere };
      const { [roomId]: _, ...rooms } = s.rooms;
      const activeRoomId =
        s.activeRoomId === roomId ? (sortRooms(rooms)[0]?.id ?? null) : s.activeRoomId;
      writeActive(activeRoomId);
      return { rooms, activeRoomId, unreadElsewhere };
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
    set({
      rooms: {},
      unreadElsewhere: [],
      loaded: false,
      error: null,
      filter: "all",
      lists: { all: NOT_LOADED, unread: NOT_LOADED },
      loadingMore: false,
    });
  },
}));

/** Loads a page of `filter`'s list (its first page without `cursor`) and merges its rooms in. */
async function loadPage(filter: RoomFilter, cursor: string | undefined) {
  const gen = generation;
  useRooms.setState({ loadingMore: true });
  try {
    const page = await api.getRooms({ before: cursor, unread: filter === "unread" });
    if (gen !== generation) return; // the rooms were replaced meanwhile
    useRooms.setState((s) => {
      // Only if nothing else moved this list on meanwhile.
      if (s.lists[filter].loaded && s.lists[filter].cursor !== (cursor ?? null)) return s;
      if (!cursor && s.lists[filter].loaded) return s;
      const rooms = { ...s.rooms };
      for (const r of page.rooms) rooms[r.id] = keepNewer(r, s.rooms[r.id], false);
      return { rooms, lists: { ...s.lists, [filter]: { loaded: true, cursor: page.nextCursor } } };
    });
  } catch (e) {
    console.warn("Loading rooms failed:", e);
  } finally {
    if (gen === generation) useRooms.setState({ loadingMore: false });
  }
}

/** The room, or null if the user can't see it (anymore). */
async function fetchRoom(roomId: number): Promise<Room | null> {
  try {
    return await api.getRoom(roomId);
  } catch (e) {
    if (e instanceof ApiRequestError && (e.status === 403 || e.status === 404)) return null;
    throw e;
  }
}
