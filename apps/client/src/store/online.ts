import { create } from "zustand";
import type { LastSeen, PresenceMember, User, UserSeenEvent } from "@pm/shared";

const toUser = (m: PresenceMember): User => ({ id: Number(m.id), ...m.info });

interface OnlineState {
  users: Record<number, User>;
  /** Newer `lastSeen`s than the ones in loaded rooms' members, from USER_SEEN_EVENT. Read it with `lastSeenOf`. */
  lastSeen: Record<number, LastSeen>;
  /** Applies USER_SEEN_EVENT. */
  applySeen: (event: UserSeenEvent) => void;
  /** Replaces the list with the full snapshot sent when the presence channel is (re)subscribed. */
  setMembers: (members: PresenceMember[]) => void;
  add: (member: PresenceMember) => void;
  remove: (member: PresenceMember) => void;
  update: (user: User) => void;
  reset: () => void;
}

export const useOnline = create<OnlineState>((set) => ({
  users: {},
  lastSeen: {},

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

  applySeen: ({ seen }) =>
    set((s) => ({ lastSeen: { ...s.lastSeen, ...Object.fromEntries(seen.map((x) => [x.userId, x.lastSeen])) } })),

  update: (user) =>
    set((s) => (s.users[user.id] ? { users: { ...s.users, [user.id]: user } } : s)),

  reset: () => set({ users: {}, lastSeen: {} }),
}));

/** What came over realtime since the room list loaded, else what it loaded. */
export const lastSeenOf = (lastSeen: Record<number, LastSeen>, userId: number, loaded: LastSeen | null): LastSeen | null =>
  lastSeen[userId] ?? loaded;
