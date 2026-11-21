import { create } from "zustand";

/** How long a "typing" signal stays valid without a refresh. */
export const TYPING_TTL_MS = 4000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const key = (roomId: number, userId: number) => `${roomId}:${userId}`;

export const NO_TYPERS: number[] = [];

interface TypingState {
  /** User ids currently typing, by room. */
  byRoom: Record<number, number[]>;
  start: (roomId: number, userId: number) => void;
  stop: (roomId: number, userId: number) => void;
  reset: () => void;
}

export const useTyping = create<TypingState>((set, get) => ({
  byRoom: {},

  start: (roomId, userId) => {
    const k = key(roomId, userId);
    clearTimeout(timers.get(k));
    timers.set(k, setTimeout(() => get().stop(roomId, userId), TYPING_TTL_MS));
    set((s) => {
      const ids = s.byRoom[roomId] ?? [];
      return ids.includes(userId) ? s : { byRoom: { ...s.byRoom, [roomId]: [...ids, userId] } };
    });
  },

  stop: (roomId, userId) => {
    const k = key(roomId, userId);
    clearTimeout(timers.get(k));
    timers.delete(k);
    set((s) => {
      const ids = s.byRoom[roomId];
      if (!ids?.includes(userId)) return s;
      return { byRoom: { ...s.byRoom, [roomId]: ids.filter((id) => id !== userId) } };
    });
  },

  reset: () => {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    set({ byRoom: {} });
  },
}));
