import { create } from "zustand";
import type { PresenceMember, User } from "@pm/shared";

const toUser = (m: PresenceMember): User => ({ id: Number(m.id), ...m.info });

interface OnlineState {
  users: Record<number, User>;
  /** Replaces the list with the full snapshot sent when the presence channel is (re)subscribed. */
  setMembers: (members: PresenceMember[]) => void;
  add: (member: PresenceMember) => void;
  remove: (member: PresenceMember) => void;
  update: (user: User) => void;
  reset: () => void;
}

export const useOnline = create<OnlineState>((set) => ({
  users: {},

  setMembers: (members) => {
    const users: Record<number, User> = {};
    for (const m of members) {
      const u = toUser(m);
      users[u.id] = u;
    }
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
