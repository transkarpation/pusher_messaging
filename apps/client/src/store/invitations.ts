import { create } from "zustand";
import type { Invitation, User } from "@pm/shared";
import { api } from "../api";
import { useRooms } from "./rooms";

interface InvitationsState {
  /** Pending invitations to the current user, newest first. */
  list: Invitation[];
  fetch: () => Promise<void>;
  add: (invitation: Invitation) => void;
  remove: (roomId: number) => void;
  /** Joins the room and opens it. Throws on failure. */
  accept: (roomId: number) => Promise<void>;
  /** Throws on failure. */
  decline: (roomId: number) => Promise<void>;
  updateUser: (user: User) => void;
  reset: () => void;
}

export const useInvitations = create<InvitationsState>((set, get) => ({
  list: [],

  fetch: async () => {
    try {
      set({ list: await api.getInvitations() });
    } catch (e) {
      console.warn("Loading invitations failed:", e);
    }
  },

  add: (invitation) =>
    set((s) => ({ list: [invitation, ...s.list.filter((i) => i.roomId !== invitation.roomId)] })),

  remove: (roomId) => set((s) => ({ list: s.list.filter((i) => i.roomId !== roomId) })),

  accept: async (roomId) => {
    const room = await api.acceptInvitation(roomId);
    get().remove(roomId);
    const rooms = useRooms.getState();
    rooms.upsert(room);
    rooms.setActive(room.id);
  },

  decline: async (roomId) => {
    await api.declineInvitation(roomId);
    get().remove(roomId);
  },

  updateUser: (user) =>
    set((s) => ({
      list: s.list.map((i) => (i.invitedBy?.id === user.id ? { ...i, invitedBy: user } : i)),
    })),

  reset: () => set({ list: [] }),
}));
