import { create } from "zustand";
import type { User } from "@pm/shared";
import { api } from "../api";

interface BlocksState {
  /** People the current user blocked, most recently blocked first. */
  blocked: User[];
  /** Ids of `blocked`, for quick lookups. */
  ids: ReadonlySet<number>;
  loaded: boolean;
  fetch: () => Promise<void>;
  /** Replaces the list (from an API response or another tab's realtime event). */
  set: (blocked: User[]) => void;
  /** Throws on failure. */
  block: (userId: number) => Promise<void>;
  /** Throws on failure. */
  unblock: (userId: number) => Promise<void>;
  reset: () => void;
}

const NO_IDS: ReadonlySet<number> = new Set();

export const useBlocks = create<BlocksState>((set, get) => ({
  blocked: [],
  ids: NO_IDS,
  loaded: false,

  fetch: async () => {
    try {
      const { blocked } = await api.getBlocks();
      get().set(blocked);
    } catch (e) {
      console.warn("Loading blocked users failed:", e);
    }
  },

  set: (blocked) => set({ blocked, ids: new Set(blocked.map((u) => u.id)), loaded: true }),

  block: async (userId) => {
    const { blocked } = await api.block({ userId });
    get().set(blocked);
  },

  unblock: async (userId) => {
    const { blocked } = await api.unblock(userId);
    get().set(blocked);
  },

  reset: () => set({ blocked: [], ids: NO_IDS, loaded: false }),
}));

/** Whether messages from this user are hidden from the current user. */
export const isBlocked = (userId: number) => useBlocks.getState().ids.has(userId);
