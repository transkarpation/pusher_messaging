import { create } from "zustand";
import {
  type Message,
  type Receipt,
  type User,
} from "@pm/shared";
import { api } from "../api";
import { latestVersion } from "../lib/messageVersion";
import { useRooms } from "./rooms";

/** A message the server hasn't confirmed yet. */
export interface PendingMessage {
  tempId: string;
  text: string;
  createdAt: string;
  status: "sending" | "failed";
}

export interface RoomMessages {
  messages: Message[];
  pending: PendingMessage[];
  /** Delivered/read watermarks in this room by user id. */
  receipts: Record<number, Receipt>;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  /**
   * The oldest message of the room is loaded: the whole history is here, so
   * scrolling up doesn't ask the server for more.
   */
  reachedStart: boolean;
  /** An older page is being fetched (scrolled to the top). */
  loadingOlder: boolean;
  /** Last failure loading an older page; cleared on the next attempt. */
  olderError: string | null;
}

export const EMPTY_ROOM: RoomMessages = {
  messages: [],
  pending: [],
  receipts: {},
  loaded: false,
  loading: false,
  error: null,
  reachedStart: false,
  loadingOlder: false,
  olderError: null,
};

interface MessagesState {
  byRoom: Record<number, RoomMessages>;
  fetch: (roomId: number) => Promise<void>;
  /**
   * Loads the page of messages just before the oldest one we have. No-op until the room
   * is loaded, while a page is in flight, and once `reachedStart` is set.
   */
  loadOlder: (roomId: number) => Promise<void>;
  /**
   * Loads messages missed while realtime was disconnected (everything after the
   * newest one we have), then refetches the latest page to pick up edits and
   * deletions made meanwhile. Rooms not loaded yet are left to `fetch`.
   */
  catchUp: (roomId: number) => Promise<void>;
  send: (roomId: number, text: string) => Promise<void>;
  retry: (roomId: number, tempId: string) => Promise<void>;
  /** Saves new text of the caller's own message. Throws on failure. */
  edit: (roomId: number, messageId: number, text: string) => Promise<void>;
  /** Deletes a message (own, or anyone's for the room owner), leaving a placeholder. Throws on failure. */
  remove: (roomId: number, messageId: number, meId: number) => Promise<void>;
  /** Adds a realtime message (deduplicated); ignored for rooms not loaded yet. */
  receive: (message: Message) => void;
  /** Applies an edited message here and in the room list. */
  applyUpdate: (message: Message) => void;
  /** Applies a deletion here and in the room list; a repeated one is ignored. */
  applyDelete: (message: Message, meId: number) => void;
  applyReceipt: (receipt: Receipt) => void;
  updateAuthor: (user: User) => void;
  drop: (roomId: number) => void;
  reset: () => void;
}

/**
 * Merges lists by id and keeps them ordered, so realtime events and fetches can interleave.
 * For the same id the most recent version wins (see `latestVersion`).
 */
const merge = (a: Message[], b: Message[]) => {
  const byId = new Map<number, Message>();
  for (const m of [...a, ...b]) {
    const prev = byId.get(m.id);
    byId.set(m.id, prev ? latestVersion(prev, m) : m);
  }
  return [...byId.values()].sort((x, y) => x.id - y.id);
};

/** Ids whose deletion was already applied, so the unread count isn't decremented twice. */
const appliedDeletions = new Set<number>();

/** Watermarks only move forward, so out-of-order events can't regress them. */
const mergeReceipt = (prev: Receipt | undefined, next: Receipt): Receipt =>
  prev
    ? {
        ...next,
        deliveredUpTo: Math.max(prev.deliveredUpTo, next.deliveredUpTo),
        readUpTo: Math.max(prev.readUpTo, next.readUpTo),
      }
    : next;

let tempCounter = 0;

/** Pages fetched by `catchUp` before giving up and reloading only the latest page. */
const MAX_CATCH_UP_PAGES = 5;
/** Rooms with a `catchUp` in flight, so repeated reconnects don't overlap. */
const catchingUp = new Set<number>();

export const useMessages = create<MessagesState>((set, get) => {
  const patch = (roomId: number, fn: (r: RoomMessages) => Partial<RoomMessages>) =>
    set((s) => {
      const room = s.byRoom[roomId];
      return room ? { byRoom: { ...s.byRoom, [roomId]: { ...room, ...fn(room) } } } : s;
    });

  /** Merges a fetched page into a room's messages and receipts. */
  const mergePage = (r: RoomMessages, messages: Message[], receipts: Receipt[]) => {
    const next = { ...r.receipts };
    for (const rc of receipts) next[rc.userId] = mergeReceipt(next[rc.userId], rc);
    return { messages: merge(r.messages, messages), receipts: next };
  };

  const post = async (roomId: number, tempId: string, text: string) => {
    try {
      const msg = await api.createMessage(roomId, { text });
      patch(roomId, (r) => ({
        messages: merge(r.messages, [msg]),
        pending: r.pending.filter((p) => p.tempId !== tempId),
      }));
      useRooms.getState().onMessage(msg, { fromMe: true, viewing: true });
    } catch {
      patch(roomId, (r) => ({
        pending: r.pending.map((p) => (p.tempId === tempId ? { ...p, status: "failed" } : p)),
      }));
    }
  };

  /**
   * Refetches the latest page, picking up edits and deletions made while we were
   * offline. Older messages outside that page keep the version we have.
   */
  const resyncLatest = async (roomId: number) => {
    const { messages: page, receipts } = await api.getMessages(roomId);
    patch(roomId, (r) => mergePage(r, page, receipts));
  };

  return {
    byRoom: {},

    fetch: async (roomId) => {
      const current = get().byRoom[roomId];
      if (current?.loaded || current?.loading) return;
      // Create the entry first so realtime messages arriving meanwhile are kept.
      set((s) => ({
        byRoom: { ...s.byRoom, [roomId]: { ...(current ?? EMPTY_ROOM), loading: true, error: null } },
      }));
      try {
        const { messages, receipts, hasMore } = await api.getMessages(roomId);
        patch(roomId, (r) => ({
          ...mergePage(r, messages, receipts),
          loaded: true,
          loading: false,
          reachedStart: !hasMore,
        }));
      } catch (e) {
        patch(roomId, () => ({ loading: false, error: (e as Error).message }));
      }
    },

    loadOlder: async (roomId) => {
      const current = get().byRoom[roomId];
      if (!current?.loaded || current.reachedStart || current.loadingOlder) return;
      const before = current.messages[0]?.id;
      if (before === undefined) return; // empty room: `fetch` already set reachedStart
      patch(roomId, () => ({ loadingOlder: true, olderError: null }));
      try {
        const { messages, receipts, hasMore } = await api.getMessages(roomId, { before });
        patch(roomId, (r) => ({ ...mergePage(r, messages, receipts), loadingOlder: false, reachedStart: !hasMore }));
      } catch (e) {
        patch(roomId, () => ({ loadingOlder: false, olderError: (e as Error).message }));
      }
    },

    catchUp: async (roomId) => {
      const current = get().byRoom[roomId];
      if (!current) return; // never opened: `fetch` will get the latest page
      if (!current.loaded) return get().fetch(roomId); // retries a failed load; no-op while loading
      if (catchingUp.has(roomId)) return;
      catchingUp.add(roomId);
      try {
        let after = current.messages.at(-1)?.id ?? 0;
        for (let page = 0; page < MAX_CATCH_UP_PAGES; page++) {
          const { messages, receipts, hasMore } = await api.getMessages(roomId, { after });
          if (!get().byRoom[roomId]) return; // room left meanwhile
          patch(roomId, (r) => mergePage(r, messages, receipts));
          if (!hasMore) {
            await resyncLatest(roomId);
            return;
          }
          after = messages.at(-1)!.id;
        }
        // Too far behind: start over from the latest page, like a first load, keeping unsent messages.
        set((s) => {
          const r = s.byRoom[roomId];
          return r ? { byRoom: { ...s.byRoom, [roomId]: { ...EMPTY_ROOM, pending: r.pending } } } : s;
        });
        await get().fetch(roomId);
      } catch (e) {
        console.warn(`Catching up room ${roomId} failed:`, e);
      } finally {
        catchingUp.delete(roomId);
      }
    },

    send: async (roomId, text) => {
      const tempId = `tmp-${++tempCounter}`;
      const item: PendingMessage = { tempId, text, createdAt: new Date().toISOString(), status: "sending" };
      patch(roomId, (r) => ({ pending: [...r.pending, item] }));
      await post(roomId, tempId, text);
    },

    retry: async (roomId, tempId) => {
      const item = get().byRoom[roomId]?.pending.find((p) => p.tempId === tempId);
      if (!item || item.status !== "failed") return;
      patch(roomId, (r) => ({
        pending: r.pending.map((p) => (p.tempId === tempId ? { ...p, status: "sending" } : p)),
      }));
      await post(roomId, tempId, item.text);
    },

    edit: async (roomId, messageId, text) => {
      const msg = await api.updateMessage(roomId, messageId, { text });
      get().applyUpdate(msg);
    },

    remove: async (roomId, messageId, meId) => {
      const msg = await api.deleteMessage(roomId, messageId);
      get().applyDelete(msg, meId);
    },

    receive: (msg) => patch(msg.roomId, (r) => ({ messages: merge(r.messages, [msg]) })),

    applyUpdate: (msg) => {
      // Only replace a message we have: adding an older one would leave a gap in the history.
      patch(msg.roomId, (r) =>
        r.messages.some((m) => m.id === msg.id) ? { messages: merge(r.messages, [msg]) } : {},
      );
      useRooms.getState().onMessageUpdated(msg);
    },

    applyDelete: (msg, meId) => {
      if (appliedDeletions.has(msg.id)) return;
      appliedDeletions.add(msg.id);
      patch(msg.roomId, (r) =>
        r.messages.some((m) => m.id === msg.id) ? { messages: merge(r.messages, [msg]) } : {},
      );
      useRooms.getState().onMessageDeleted(msg, { fromMe: msg.author.id === meId });
    },

    applyReceipt: (rc) =>
      patch(rc.roomId, (r) => ({
        receipts: { ...r.receipts, [rc.userId]: mergeReceipt(r.receipts[rc.userId], rc) },
      })),

    updateAuthor: (user) =>
      set((s) => {
        const byRoom: Record<number, RoomMessages> = {};
        for (const [id, r] of Object.entries(s.byRoom)) {
          byRoom[Number(id)] = {
            ...r,
            messages: r.messages.map((m) => (m.author.id === user.id ? { ...m, author: user } : m)),
          };
        }
        return { byRoom };
      }),

    drop: (roomId) =>
      set((s) => {
        const { [roomId]: _, ...byRoom } = s.byRoom;
        return { byRoom };
      }),

    reset: () => {
      appliedDeletions.clear();
      set({ byRoom: {} });
    },
  };
});
