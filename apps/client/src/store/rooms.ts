import { create } from "zustand";
import type { Message, Receipt, Room, RoomMember, User } from "@pm/shared";
import { api } from "../api";

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

/** Most recently active rooms first. */
export function sortRooms(rooms: Record<number, Room>): Room[] {
  const activity = (r: Room) => r.lastMessage?.createdAt ?? r.createdAt;
  return Object.values(rooms).sort((a, b) => activity(b).localeCompare(activity(a)));
}

/**
 * A refetched room, keeping what realtime events delivered while the request was
 * in flight: a newer last message (with its unread count) and further-moved watermarks.
 */
function keepNewer(fetched: Room, local: Room | undefined): Room {
  if (!local) return fetched;
  const localIsNewer =
    !!local.lastMessage && local.lastMessage.id > (fetched.lastMessage?.id ?? 0);
  const myReceipt = {
    deliveredUpTo: Math.max(fetched.myReceipt.deliveredUpTo, local.myReceipt.deliveredUpTo),
    readUpTo: Math.max(fetched.myReceipt.readUpTo, local.myReceipt.readUpTo),
  };
  const room = localIsNewer
    ? { ...fetched, lastMessage: local.lastMessage, unreadCount: local.unreadCount, myReceipt }
    : { ...fetched, myReceipt };
  const caughtUp = myReceipt.readUpTo >= (room.lastMessage?.id ?? 0);
  return caughtUp ? { ...room, unreadCount: 0 } : room;
}

interface RoomsState {
  rooms: Record<number, Room>;
  loaded: boolean;
  error: string | null;
  activeRoomId: number | null;
  fetch: () => Promise<void>;
  upsert: (room: Room) => void;
  remove: (roomId: number) => void;
  setActive: (roomId: number | null) => void;
  setMembers: (roomId: number, members: RoomMember[]) => void;
  /** Updates last message and unread count for a new message in a room. */
  onMessage: (message: Message, opts: { fromMe: boolean; viewing: boolean }) => void;
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

  fetch: async () => {
    try {
      const list = await api.getRooms();
      const { rooms: prev, activeRoomId } = get();
      const rooms = Object.fromEntries(list.map((r) => [r.id, keepNewer(r, prev[r.id])]));
      const active =
        activeRoomId && rooms[activeRoomId] ? activeRoomId : (sortRooms(rooms)[0]?.id ?? null);
      writeActive(active);
      set({ rooms, loaded: true, error: null, activeRoomId: active });
    } catch (e) {
      // A failed refresh (e.g. after a reconnect) keeps the list we already have.
      if (get().loaded && !get().error) console.warn("Refreshing rooms failed:", e);
      else set({ loaded: true, error: (e as Error).message });
    }
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

  setMembers: (roomId, members) =>
    set((s) => {
      const room = s.rooms[roomId];
      return room ? { rooms: { ...s.rooms, [roomId]: { ...room, members } } } : s;
    }),

  onMessage: (message, { fromMe, viewing }) =>
    set((s) => {
      const room = s.rooms[message.roomId];
      if (!room) return s;
      const isNewer = !room.lastMessage || message.id > room.lastMessage.id;
      return {
        rooms: {
          ...s.rooms,
          [room.id]: {
            ...room,
            lastMessage: isNewer ? message : room.lastMessage,
            unreadCount: room.unreadCount + (isNewer && !fromMe && !viewing ? 1 : 0),
          },
        },
      };
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
          lastMessage:
            room.lastMessage?.author.id === user.id
              ? { ...room.lastMessage, author: user }
              : room.lastMessage,
        };
      }
      return { rooms };
    }),

  reset: () => set({ rooms: {}, loaded: false, error: null }),
}));
