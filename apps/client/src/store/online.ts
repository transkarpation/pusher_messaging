import { create } from "zustand";
import type { Members } from "pusher-js";
import type { PresenceUserInfo, User } from "@pm/shared";

export interface PresenceMember {
  id: string;
  info: PresenceUserInfo;
}

const toUser = (m: PresenceMember): User => ({ id: Number(m.id), ...m.info });

interface OnlineState {
  users: Record<number, User>;
  /** Replaces the list with a full snapshot from `pusher:subscription_succeeded`. */
  setMembers: (members: Members) => void;
  add: (member: PresenceMember) => void;
  remove: (member: PresenceMember) => void;
  update: (user: User) => void;
  reset: () => void;
}

export const useOnline = create<OnlineState>((set) => ({
  users: {},

  setMembers: (members) => {
    const users: Record<number, User> = {};
    members.each((m: PresenceMember) => {
      const u = toUser(m);
      users[u.id] = u;
    });
    set({ users });
  },

  add: (member) => {
    const u = toUser(member);
    set((s) => ({ users: { ...s.users, [u.id]: u } }));
  },

  remove: (member) =>
    set((s) => {
      const { [Number(member.id)]: _, ...rest } = s.users;
      return { users: rest };
    }),

  update: (user) =>
    set((s) => (s.users[user.id] ? { users: { ...s.users, [user.id]: user } } : s)),

  reset: () => set({ users: {} }),
}));
